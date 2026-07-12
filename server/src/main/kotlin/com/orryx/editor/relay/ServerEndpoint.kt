package com.orryx.editor.relay

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.protocol.MessageParseResult
import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolLimits
import com.orryx.editor.protocol.WsMessage
import com.orryx.editor.protocol.WsProtocol
import com.orryx.editor.protocol.WsResponse
import io.ktor.websocket.WebSocketSession
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

private const val DEFAULT_TOKEN_TTL_MILLIS = 300_000L
private const val MAX_TOKEN_TTL_MILLIS = 600_000L

class ServerEndpoint(
    private val registry: SessionRegistry,
    private val licenseAccess: RelayLicenseAccess
) {
    constructor(registry: SessionRegistry, licenseManager: LicenseManager) :
        this(registry, LicenseManagerRelayAccess(licenseManager))

    private val sessionIps = ConcurrentHashMap<RelaySocket, String>()

    fun onServerConnect(session: WebSocketSession, remoteIp: String) {
        onServerConnect(registry.socket(session), remoteIp)
    }

    fun onServerConnect(session: RelaySocket, remoteIp: String) {
        sessionIps[session] = remoteIp
    }

    suspend fun handleServerMessage(serverSession: WebSocketSession, text: String) {
        handleServerMessage(registry.socket(serverSession), text)
    }

    suspend fun handleServerMessage(serverSession: RelaySocket, text: String) {
        registry.cleanupExpiredRequests()
        val msg = when (val parsed = WsProtocol.parse(text)) {
            is MessageParseResult.Success -> parsed.message
            is MessageParseResult.Failure -> {
                serverSession.sendText(WsResponse.error("", parsed.error.code, parsed.error.message))
                return
            }
        }

        when (msg.type) {
            "server.register" -> handleRegister(serverSession, msg)
            "token.register" -> handleTokenRegister(serverSession, msg)
            "token.revoke" -> handleTokenRevoke(serverSession, msg)
            else -> relayPluginMessage(serverSession, msg)
        }
    }

    private suspend fun handleRegister(session: RelaySocket, msg: WsMessage) {
        val data = msg.data.jsonObject
        val license = data["license"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val rawName = data["serverName"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val name = RelayValidation.serverName(rawName)
        if (license.length !in 8..ProtocolLimits.MAX_TOKEN_LENGTH || license.any(Char::isWhitespace)) {
            sendRegisterFailure(session, msg.id, "INVALID_LICENSE", "license 无效")
            return
        }
        if (name == null) {
            sendRegisterFailure(session, msg.id, "INVALID_SERVER_NAME", "serverName 无效")
            return
        }
        val explicitServerId = data["serverId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
        val serverId = if (explicitServerId == null) {
            RelayValidation.serverId(name) ?: "name-${RelaySecrets.sha256(name).take(32)}"
        } else {
            RelayValidation.serverId(explicitServerId)
        }
        if (serverId == null) {
            sendRegisterFailure(session, msg.id, "INVALID_SERVER_ID", "serverId 无效")
            return
        }

        val connectIp = sessionIps[session].orEmpty()
        val entry = licenseAccess.validate(license, connectIp)
        if (entry == null) {
            val raw = licenseAccess.get(license)
            val code = when {
                raw == null -> "LICENSE_NOT_FOUND"
                !raw.enabled -> "LICENSE_DISABLED"
                raw.isExpired() -> "LICENSE_EXPIRED"
                !raw.isIpAllowed(connectIp) -> "IP_NOT_ALLOWED"
                else -> "INVALID_LICENSE"
            }
            sendRegisterFailure(session, msg.id, code, "license 校验失败")
            return
        }

        if (connectIp.isNotEmpty() && connectIp !in entry.boundIps) {
            licenseAccess.addIp(license, connectIp)
        }

        val server = registry.registerServer(license, entry.serverKey, name, serverId, session)
        session.sendText(WsResponse.build(
            "server.register.result",
            msg.id,
            "success" to true,
            "serverKey" to entry.serverKey,
            "serverId" to server.serverId,
            "workspaceId" to server.workspaceId,
            "message" to "服务器已注册"
        ))
    }

    private suspend fun handleTokenRegister(session: RelaySocket, msg: WsMessage) {
        val server = registry.getServerBySession(session)
        if (server == null) {
            session.sendText(WsResponse.error(msg.id, "SERVER_NOT_REGISTERED", "请先发送 server.register"))
            return
        }

        val data = msg.data.jsonObject
        val token = RelayValidation.token(data["token"]?.jsonPrimitive?.contentOrNull.orEmpty())
        val playerName = RelayValidation.playerName(data["playerName"]?.jsonPrimitive?.contentOrNull.orEmpty())
        val expiresIn = data["expiresIn"]?.jsonPrimitive?.longOrNull ?: DEFAULT_TOKEN_TTL_MILLIS
        if (token == null) {
            session.sendText(WsResponse.error(msg.id, "INVALID_TOKEN", "token 无效"))
            return
        }
        if (playerName == null) {
            session.sendText(WsResponse.error(msg.id, "INVALID_PLAYER_NAME", "playerName 无效"))
            return
        }
        if (expiresIn !in 1_000L..MAX_TOKEN_TTL_MILLIS) {
            session.sendText(WsResponse.error(msg.id, "INVALID_EXPIRY", "expiresIn 超出允许范围"))
            return
        }

        if (!registry.registerToken(token, session, playerName, expiresIn)) {
            session.sendText(WsResponse.error(msg.id, "TOKEN_ALREADY_EXISTS", "token 已存在"))
            return
        }
        session.sendText(WsResponse.build(
            "token.register.result",
            msg.id,
            "success" to true,
            "token" to token,
            "workspaceId" to server.workspaceId,
            "expiresIn" to expiresIn
        ))
    }

    private suspend fun handleTokenRevoke(session: RelaySocket, msg: WsMessage) {
        if (registry.getServerBySession(session) == null) {
            session.sendText(WsResponse.error(msg.id, "SERVER_NOT_REGISTERED", "请先发送 server.register"))
            return
        }
        val token = RelayValidation.token(msg.data.jsonObject["token"]?.jsonPrimitive?.contentOrNull.orEmpty())
        if (token == null) {
            session.sendText(WsResponse.error(msg.id, "INVALID_TOKEN", "token 无效"))
            return
        }
        registry.revokeToken(token, session)
        session.sendText(WsResponse.build("token.revoke.result", msg.id, "success" to true))
    }

    private suspend fun relayPluginMessage(serverSession: RelaySocket, msg: WsMessage) {
        val server = registry.getServerBySession(serverSession)
        if (server == null) {
            serverSession.sendText(WsResponse.error(msg.id, "SERVER_NOT_REGISTERED", "请先发送 server.register"))
            return
        }

        val pending = registry.takePendingRequest(msg.id, serverSession)
        if (pending != null) {
            relayCorrelatedResponse(server, pending, msg)
            return
        }

        if (msg.type !in BROADCAST_TYPES) return
        val broadcastMessage = sanitizeWorkspaceBroadcast(server, msg) ?: return
        registry.getBrowsersForWorkspace(server.workspaceId).forEach { browser ->
            try {
                browser.sendText(broadcastMessage)
            } catch (_: Exception) {
                registry.unbindBrowser(browser)
            }
        }
    }

    private suspend fun relayCorrelatedResponse(server: GameServer, pending: PendingRequest, msg: WsMessage) {
        val data = msg.data.jsonObject
        val successfulWrite = pending.type == MessageTypes.FILE_WRITE &&
            msg.type == MessageTypes.FILE_WRITTEN &&
            data["success"]?.jsonPrimitive?.booleanOrNull != false
        val newRevision = registry.finishRequest(pending, successfulWrite)

        val responseType: String
        val responseData: JsonObject
        if (msg.type == MessageTypes.ERROR) {
            responseType = MessageTypes.ERROR
            responseData = JsonObject(mapOf(
                "code" to JsonPrimitive("PLUGIN_ERROR"),
                "message" to JsonPrimitive("插件请求失败")
            ))
        } else {
            responseType = msg.type
            val additions = mutableMapOf<String, kotlinx.serialization.json.JsonElement>()
            if (pending.type == MessageTypes.FILE_READ && pending.path != null) {
                additions["revision"] = JsonPrimitive(registry.currentRevision(pending.workspaceId, pending.path))
            }
            if (newRevision != null) additions["revision"] = JsonPrimitive(newRevision)
            responseData = JsonObject(data + additions)
        }

        try {
            pending.browserSession.sendText(WsProtocol.encode(WsMessage(responseType, pending.originalId, responseData)))
        } catch (_: Exception) {
            registry.unbindBrowser(pending.browserSession)
        }

        if (newRevision != null && pending.path != null) {
            broadcastFileChanged(server.workspaceId, pending.path, newRevision, pending.browserId)
        }
    }

    private fun sanitizeWorkspaceBroadcast(server: GameServer, msg: WsMessage): String? {
        val data = msg.data.jsonObject
        val additions = mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
            "workspaceId" to JsonPrimitive(server.workspaceId)
        )
        if (msg.type == MessageTypes.FILE_CHANGED) {
            val path = RelayValidation.path(data["path"]?.jsonPrimitive?.contentOrNull.orEmpty()) ?: return null
            additions["path"] = JsonPrimitive(path)
            additions["revision"] = JsonPrimitive(registry.currentRevision(server.workspaceId, path))
        }
        return WsProtocol.encode(WsMessage(msg.type, "", JsonObject(data + additions)))
    }

    private suspend fun broadcastFileChanged(
        workspaceId: String,
        path: String,
        revision: Long,
        browserId: String
    ) {
        val message = WsResponse.build(
            MessageTypes.FILE_CHANGED,
            "",
            "workspaceId" to workspaceId,
            "path" to path,
            "revision" to revision,
            "browserId" to browserId
        )
        registry.getBrowsersForWorkspace(workspaceId).forEach { browser ->
            try {
                browser.sendText(message)
            } catch (_: Exception) {
                registry.unbindBrowser(browser)
            }
        }
    }

    private suspend fun sendRegisterFailure(session: RelaySocket, id: String, code: String, message: String) {
        session.sendText(WsResponse.build(
            "server.register.result",
            id,
            "success" to false,
            "code" to code,
            "message" to message
        ))
    }

    suspend fun onServerDisconnect(session: WebSocketSession) {
        val socket = registry.socket(session)
        onServerDisconnect(socket)
        registry.releaseSocket(session)
    }

    suspend fun onServerDisconnect(session: RelaySocket) {
        sessionIps.remove(session)
        val workspaceId = registry.getServerBySession(session)?.workspaceId
        registry.unregisterServer(session)
        if (workspaceId != null) broadcastPresence(workspaceId)
    }

    private suspend fun broadcastPresence(workspaceId: String) {
        val users = buildJsonArray {
            registry.getPresence(workspaceId).forEach { binding ->
                add(buildJsonObject {
                    put("browserId", binding.browserId)
                    put("playerName", binding.playerName)
                    put("workspaceId", binding.workspaceId)
                    if (binding.currentFile == null) {
                        put("currentFile", kotlinx.serialization.json.JsonNull)
                    } else {
                        put("currentFile", binding.currentFile)
                    }
                    put("lastActiveAt", binding.lastActiveAt)
                })
            }
        }
        val message = WsResponse.build(
            MessageTypes.PRESENCE_UPDATED,
            "",
            "workspaceId" to workspaceId,
            "members" to users
        )
        registry.getBrowsersForWorkspace(workspaceId).forEach { browser ->
            try {
                browser.sendText(message)
            } catch (_: Exception) {
                registry.unbindBrowser(browser)
            }
        }
    }

    private companion object {
        val BROADCAST_TYPES = setOf(
            MessageTypes.LOG_ENTRY,
            MessageTypes.PRESENCE_UPDATED,
            MessageTypes.FILE_CHANGED
        )
    }
}
