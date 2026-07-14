package com.orryx.editor.relay

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.protocol.ContractValidationResult
import com.orryx.editor.protocol.MessageDirection
import com.orryx.editor.protocol.MessageParseResult
import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolContracts
import com.orryx.editor.protocol.ProtocolLimits
import com.orryx.editor.protocol.ProtocolRole
import com.orryx.editor.protocol.ProtocolVersion
import com.orryx.editor.protocol.WsMessage
import com.orryx.editor.protocol.WsProtocol
import com.orryx.editor.protocol.WsResponse
import io.ktor.websocket.WebSocketSession
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
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
    private val licenseAccess: RelayLicenseAccess,
    private val features: RelayFeatureFlags = RelayFeatureFlags(),
    private val onRegistered: suspend (GameServer) -> String? = { null },
    private val onReleaseResult: suspend (GameServer, WsMessage) -> Unit = { _, _ -> }
) {
    constructor(
        registry: SessionRegistry,
        licenseManager: LicenseManager,
        features: RelayFeatureFlags = RelayFeatureFlags(),
        onRegistered: suspend (GameServer) -> String? = { null },
        onReleaseResult: suspend (GameServer, WsMessage) -> Unit = { _, _ -> }
    ) : this(registry, LicenseManagerRelayAccess(licenseManager), features, onRegistered, onReleaseResult)

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

        val registeredServer = registry.getServerBySession(serverSession)
        val protocolVersion = registeredServer?.negotiatedProtocol ?: ProtocolVersion.V1
        when (val validation = ProtocolContracts.validate(
            type = msg.type,
            role = ProtocolRole.PLUGIN,
            direction = MessageDirection.PLUGIN_TO_RELAY,
            version = protocolVersion
        )) {
            is ContractValidationResult.Rejected -> {
                serverSession.sendText(WsResponse.error(msg.id, validation.error.code, validation.error.message))
                return
            }
            is ContractValidationResult.Allowed -> Unit
        }

        if (registeredServer != null && !registry.isAuthoritative(serverSession)) {
            serverSession.sendText(WsResponse.error(msg.id, "STALE_PLUGIN_SESSION", "插件会话已被新的 sessionEpoch 取代"))
            return
        }

        when (msg.type) {
            MessageTypes.SERVER_REGISTER -> handleRegister(serverSession, msg)
            MessageTypes.TOKEN_REGISTER -> handleTokenRegister(serverSession, msg)
            MessageTypes.TOKEN_REVOKE -> handleTokenRevoke(serverSession, msg)
            MessageTypes.RELEASE_RESULT -> {
                val server = registeredServer
                if (server == null) {
                    serverSession.sendText(WsResponse.error(msg.id, "SERVER_NOT_REGISTERED", "请先发送 server.register"))
                } else {
                    onReleaseResult(server, msg)
                }
            }
            else -> relayPluginMessage(serverSession, msg)
        }
    }

    private suspend fun handleRegister(session: RelaySocket, msg: WsMessage) {
        val data = msg.data.jsonObject
        val license = (data["license"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val rawName = (data["serverName"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        val name = RelayValidation.serverName(rawName)
        if (license.length !in 8..ProtocolLimits.MAX_TOKEN_LENGTH || license.any(Char::isWhitespace)) {
            sendRegisterFailure(session, msg.id, "INVALID_LICENSE", "license 无效")
            return
        }
        if (name == null) {
            sendRegisterFailure(session, msg.id, "INVALID_SERVER_NAME", "serverName 无效")
            return
        }
        val rawServerId = (data["serverId"] as? JsonPrimitive)?.contentOrNull
        if (data["serverId"] != null && rawServerId.isNullOrBlank()) {
            sendRegisterFailure(session, msg.id, "INVALID_SERVER_ID", "serverId 无效")
            return
        }
        val explicitServerId = rawServerId
        val serverId = if (explicitServerId == null) {
            RelayValidation.serverId(name) ?: "name-${RelaySecrets.sha256(name).take(32)}"
        } else {
            RelayValidation.serverId(explicitServerId)
        }
        if (serverId == null) {
            sendRegisterFailure(session, msg.id, "INVALID_SERVER_ID", "serverId 无效")
            return
        }

        val rawPluginVersion = (data["pluginVersion"] as? JsonPrimitive)?.contentOrNull
        val pluginVersion = rawPluginVersion?.let(RelayValidation::pluginVersion)
        if (data["pluginVersion"] != null && (rawPluginVersion == null || pluginVersion == null)) {
            sendRegisterFailure(session, msg.id, "INVALID_PLUGIN_VERSION", "pluginVersion 无效")
            return
        }
        val protocolVersions = parseProtocolVersions(data["protocolVersions"])
        if (protocolVersions == null) {
            sendRegisterFailure(session, msg.id, "UNSUPPORTED_PROTOCOL", "protocolVersions 必须只包含 v1/v2")
            return
        }
        val rawPreferredProtocol = (data["preferredProtocol"] as? JsonPrimitive)?.contentOrNull
        val preferredProtocol = rawPreferredProtocol?.let(ProtocolVersion::parse)
        if (data["preferredProtocol"] != null &&
            (rawPreferredProtocol == null || preferredProtocol == null || preferredProtocol !in protocolVersions)
        ) {
            sendRegisterFailure(session, msg.id, "INVALID_PREFERRED_PROTOCOL", "preferredProtocol 必须包含在 protocolVersions 中")
            return
        }
        val relayProtocols = if (features.protocolV2Enabled) {
            setOf(ProtocolVersion.V1, ProtocolVersion.V2)
        } else {
            setOf(ProtocolVersion.V1)
        }
        val commonProtocols = protocolVersions intersect relayProtocols
        if (commonProtocols.isEmpty()) {
            sendRegisterFailure(session, msg.id, "UNSUPPORTED_PROTOCOL", "插件与 relay 没有共同启用的协议版本")
            return
        }
        val negotiatedProtocol = preferredProtocol?.takeIf { it in commonProtocols }
            ?: commonProtocols.maxBy { it.ordinal }
        val capabilities = parseCapabilities(data["capabilities"])
        if (capabilities == null) {
            sendRegisterFailure(session, msg.id, "INVALID_CAPABILITIES", "capabilities 无效")
            return
        }
        if (negotiatedProtocol == ProtocolVersion.V2 && "revision.sha256" !in capabilities) {
            sendRegisterFailure(session, msg.id, "MISSING_CAPABILITY", "协议 V2 必须声明 revision.sha256")
            return
        }
        if (negotiatedProtocol == ProtocolVersion.V2 && features.v2WritesEnabled && "mutation.preconditions" !in capabilities) {
            sendRegisterFailure(session, msg.id, "MISSING_CAPABILITY", "启用 V2 变更路径必须声明 mutation.preconditions")
            return
        }
        if (features.releaseTransactionsEnabled) {
            val missingReleaseCapabilities = ReleaseRelayCapabilities.requiredPlugin - capabilities
            if (negotiatedProtocol != ProtocolVersion.V2 || missingReleaseCapabilities.isNotEmpty()) {
                sendRegisterFailure(
                    session,
                    msg.id,
                    "MISSING_RELEASE_CAPABILITY",
                    "启用发布事务时插件必须协商 V2 并声明完整发布能力"
                )
                return
            }
        }
        val rawConnectionNonce = (data["connectionNonce"] as? JsonPrimitive)?.contentOrNull
        val connectionNonce = rawConnectionNonce?.let(RelayValidation::connectionNonce)
        if (data["connectionNonce"] != null && (rawConnectionNonce == null || connectionNonce == null)) {
            sendRegisterFailure(session, msg.id, "INVALID_CONNECTION_NONCE", "connectionNonce 无效")
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

        val server = registry.registerServer(
            licenseKey = license,
            serverKey = entry.serverKey,
            serverName = name,
            serverId = serverId,
            session = session,
            pluginVersion = pluginVersion,
            negotiatedProtocol = negotiatedProtocol,
            capabilities = capabilities,
            connectionNonce = connectionNonce
        )
        val serverInstanceId = onRegistered(server)
        val registered = serverInstanceId?.let { registry.bindServerInstance(session, it) } ?: server
        session.sendText(WsResponse.build(
            MessageTypes.SERVER_REGISTER_RESULT,
            msg.id,
            "success" to true,
            "serverKey" to entry.serverKey,
            "serverId" to registered.serverId,
            "serverInstanceId" to registered.serverInstanceId,
            "workspaceId" to registered.workspaceId,
            "negotiatedProtocol" to registered.negotiatedProtocol.wireName,
            "sessionEpoch" to registered.sessionEpoch,
            "relayCapabilities" to relayCapabilities(registered.negotiatedProtocol, features),
            "connectionNonce" to registered.connectionNonce,
            "message" to "服务器已注册"
        ))
    }

    private fun parseProtocolVersions(element: JsonElement?): Set<ProtocolVersion>? {
        if (element == null) return setOf(ProtocolVersion.V1)
        val values = element as? JsonArray ?: return null
        if (values.isEmpty()) return null
        val parsed = values.map { value ->
            val wireName = (value as? JsonPrimitive)?.contentOrNull ?: return null
            ProtocolVersion.parse(wireName) ?: return null
        }.toSet()
        return parsed.takeIf { it.size == values.size }
    }

    private fun parseCapabilities(element: JsonElement?): Set<String>? {
        if (element == null) return emptySet()
        val values = element as? JsonArray ?: return null
        if (values.size > ProtocolLimits.MAX_CAPABILITIES) return null
        val parsed = values.map { value ->
            val capability = (value as? JsonPrimitive)?.contentOrNull ?: return null
            RelayValidation.capability(capability) ?: return null
        }.toSet()
        return parsed.takeIf { it.size == values.size }
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
            session.sendText(WsResponse.error(msg.id, "TOKEN_ALREADY_EXISTS", "token 已存在或插件会话已失效"))
            return
        }
        session.sendText(WsResponse.build(
            MessageTypes.TOKEN_REGISTER_RESULT,
            msg.id,
            "success" to true,
            "token" to token,
            "workspaceId" to server.workspaceId,
            "sessionEpoch" to server.sessionEpoch,
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
        session.sendText(WsResponse.build(MessageTypes.TOKEN_REVOKE_RESULT, msg.id, "success" to true))
    }

    private suspend fun relayPluginMessage(serverSession: RelaySocket, msg: WsMessage) {
        val server = registry.getServerBySession(serverSession)
        if (server == null) {
            serverSession.sendText(WsResponse.error(msg.id, "SERVER_NOT_REGISTERED", "请先发送 server.register"))
            return
        }

        val pending = msg.id.takeIf(String::isNotEmpty)?.let { registry.takePendingRequest(it, serverSession) }
        if (pending != null) {
            if (msg.type != pending.expectedResponseType && msg.type != MessageTypes.ERROR) {
                rejectPluginResponse(
                    pending = pending,
                    pluginSession = serverSession,
                    pluginRequestId = msg.id,
                    code = "UNEXPECTED_RESPONSE_TYPE",
                    message = "期望 ${pending.expectedResponseType}，实际 ${msg.type}",
                )
                return
            }
            relayCorrelatedResponse(server, pending, msg)
            return
        }

        if (msg.id.isNotEmpty()) {
            serverSession.sendText(WsResponse.error(msg.id, "UNKNOWN_RELAY_REQUEST", "relay request 不存在或已过期"))
            return
        }
        if (msg.type !in BROADCAST_TYPES) {
            serverSession.sendText(WsResponse.error(msg.id, "MESSAGE_DIRECTION_NOT_ALLOWED", "该插件消息不能广播"))
            return
        }
        val broadcastMessage = sanitizeWorkspaceBroadcast(server, msg) ?: run {
            serverSession.sendText(WsResponse.error(msg.id, "INVALID_REVISION", "广播 revision 无效"))
            return
        }
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
        val v2Revision = if (pending.protocolVersion == ProtocolVersion.V2) {
            val rawRevision = (data["revision"] as? JsonPrimitive)?.contentOrNull
            val validatedRevision = rawRevision?.let(RelayValidation::sha256Revision)
            if ((rawRevision != null && validatedRevision == null) ||
                (rawRevision == null && requiresV2Revision(pending, msg, data))
            ) {
                rejectPluginResponse(
                    pending = pending,
                    pluginSession = server.session,
                    pluginRequestId = msg.id,
                    code = "INVALID_REVISION",
                    message = "V2 revision 必须是 64 位小写 SHA-256",
                )
                return
            }
            validatedRevision
        } else {
            null
        }
        val successfulWrite = pending.type == MessageTypes.FILE_WRITE &&
            msg.type == MessageTypes.FILE_WRITTEN &&
            (data["success"] as? JsonPrimitive)?.booleanOrNull != false
        val newV1Revision = registry.finishRequest(pending, successfulWrite)

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
            val additions = mutableMapOf<String, JsonElement>()
            if (pending.protocolVersion == ProtocolVersion.V1 && pending.type == MessageTypes.FILE_READ && pending.path != null) {
                additions["revision"] = JsonPrimitive(registry.currentRevision(pending.workspaceId, pending.path))
            }
            if (newV1Revision != null) additions["revision"] = JsonPrimitive(newV1Revision)
            responseData = JsonObject(data + additions)
        }

        try {
            pending.browserSession.sendText(WsProtocol.encode(WsMessage(responseType, pending.originalId, responseData)))
        } catch (_: Exception) {
            registry.unbindBrowser(pending.browserSession)
        }

        if (successfulWrite && pending.path != null) {
            val revision = newV1Revision?.let(::JsonPrimitive) ?: v2Revision?.let(::JsonPrimitive)
            if (revision != null) {
                broadcastFileChanged(server.workspaceId, pending.path, revision, pending.browserId)
            }
        }
    }

    private fun requiresV2Revision(pending: PendingRequest, msg: WsMessage, data: JsonObject): Boolean =
        (pending.type == MessageTypes.FILE_READ && msg.type == MessageTypes.FILE_CONTENT) ||
            (pending.type == MessageTypes.FILE_WRITE && msg.type == MessageTypes.FILE_WRITTEN &&
                (data["success"] as? JsonPrimitive)?.booleanOrNull != false)

    private suspend fun rejectPluginResponse(
        pending: PendingRequest,
        pluginSession: RelaySocket,
        pluginRequestId: String,
        code: String,
        message: String,
    ) {
        registry.finishRequest(pending, successfulWrite = false)
        try {
            pending.browserSession.sendText(WsResponse.error(pending.originalId, code, message))
        } catch (_: Exception) {
            registry.unbindBrowser(pending.browserSession)
        }
        try {
            pluginSession.sendText(WsResponse.error(pluginRequestId, code, message))
        } catch (_: Exception) {
            // WebSocket lifecycle will remove a disconnected plugin session.
        }
    }

    private fun sanitizeWorkspaceBroadcast(server: GameServer, msg: WsMessage): String? {
        val data = msg.data.jsonObject
        val additions = mutableMapOf<String, JsonElement>(
            "workspaceId" to JsonPrimitive(server.workspaceId)
        )
        if (msg.type == MessageTypes.FILE_CHANGED) {
            val path = RelayValidation.path((data["path"] as? JsonPrimitive)?.contentOrNull.orEmpty()) ?: return null
            additions["path"] = JsonPrimitive(path)
            additions["revision"] = when (server.negotiatedProtocol) {
                ProtocolVersion.V1 -> JsonPrimitive(registry.currentRevision(server.workspaceId, path))
                ProtocolVersion.V2 -> {
                    val revision = (data["revision"] as? JsonPrimitive)?.contentOrNull
                        ?.let(RelayValidation::sha256Revision) ?: return null
                    JsonPrimitive(revision)
                }
            }
        }
        return WsProtocol.encode(WsMessage(msg.type, "", JsonObject(data + additions)))
    }

    private suspend fun broadcastFileChanged(
        workspaceId: String,
        path: String,
        revision: JsonElement,
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
            MessageTypes.SERVER_REGISTER_RESULT,
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
        val wasAuthoritative = registry.isAuthoritative(session)
        registry.unregisterServer(session)
        if (workspaceId != null && wasAuthoritative) broadcastPresence(workspaceId)
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
            MessageTypes.FILE_CHANGED,
            MessageTypes.SERVER_INFO
        )
    }
}
