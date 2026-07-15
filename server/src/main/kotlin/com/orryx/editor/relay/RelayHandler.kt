package com.orryx.editor.relay

import com.orryx.editor.protocol.ContractValidationResult
import com.orryx.editor.protocol.MessageDirection
import com.orryx.editor.protocol.MessageParseResult
import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolContracts
import com.orryx.editor.protocol.ProtocolRole
import com.orryx.editor.protocol.ProtocolVersion
import com.orryx.editor.protocol.WsMessage
import com.orryx.editor.protocol.WsProtocol
import com.orryx.editor.protocol.WsResponse
import io.ktor.websocket.WebSocketSession
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

private const val DEFAULT_RESUME_TTL_MILLIS = 24 * 60 * 60_000L

class RelayHandler(
    private val registry: SessionRegistry,
    private val sessionStore: EditorSessionStore = InMemoryEditorSessionStore(),
    private val resumeTtlMillis: Long = DEFAULT_RESUME_TTL_MILLIS,
    private val features: RelayFeatureFlags = RelayFeatureFlags()
) {
    suspend fun handleBrowserMessage(browserSession: WebSocketSession, text: String) {
        handleBrowserMessage(registry.socket(browserSession), text)
    }

    suspend fun handleBrowserMessage(browserSession: RelaySocket, text: String) {
        registry.cleanupExpiredRequests()
        val msg = when (val parsed = WsProtocol.parse(text)) {
            is MessageParseResult.Success -> parsed.message
            is MessageParseResult.Failure -> {
                browserSession.sendText(WsResponse.error("", parsed.error.code, parsed.error.message))
                return
            }
        }

        val protocolVersion = registry.getBrowserBinding(browserSession)?.protocolVersion ?: ProtocolVersion.V1
        val contract = when (val validation = ProtocolContracts.validate(
            type = msg.type,
            role = ProtocolRole.BROWSER,
            direction = MessageDirection.BROWSER_TO_RELAY,
            version = protocolVersion
        )) {
            is ContractValidationResult.Allowed -> validation.contract
            is ContractValidationResult.Rejected -> {
                browserSession.sendText(WsResponse.error(msg.id, validation.error.code, validation.error.message))
                return
            }
        }

        when (msg.type) {
            MessageTypes.AUTH -> {
                val data = msg.data.jsonObject
                if (data["resumeToken"] != null && data["token"] == null) {
                    handleResume(browserSession, msg, MessageTypes.AUTH_RESULT)
                } else {
                    handleAuth(browserSession, msg)
                }
            }
            MessageTypes.RESUME -> handleResume(browserSession, msg, MessageTypes.RESUME_RESULT)
            MessageTypes.PRESENCE_UPDATE -> handlePresenceUpdate(browserSession, msg)
            else -> forwardBrowserRequest(browserSession, msg, contract.expectedResponseType)
        }
    }

    private suspend fun handleAuth(browserSession: RelaySocket, msg: WsMessage) {
        if (registry.getBrowserBinding(browserSession) != null) {
            browserSession.sendText(WsResponse.error(msg.id, "ALREADY_AUTHENTICATED", "连接已认证"))
            return
        }
        val data = msg.data.jsonObject
        val rawToken = data["token"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val token = RelayValidation.token(rawToken)
        if (token == null) {
            sendAuthFailure(browserSession, msg.id, "INVALID_TOKEN", "Token 无效或已过期")
            return
        }
        val registered = registry.consumeToken(token)
        if (registered == null) {
            sendAuthFailure(browserSession, msg.id, "INVALID_TOKEN", "Token 无效或已过期")
            return
        }
        val server = registry.getServerBySession(registered.pluginSession)
        if (server == null) {
            sendAuthFailure(browserSession, msg.id, "SERVER_OFFLINE", "游戏服务器已断开连接")
            return
        }
        val requestedBrowserId = data["browserId"]?.jsonPrimitive?.contentOrNull
        val browserId = when {
            requestedBrowserId == null -> RelaySecrets.newToken(18)
            else -> RelayValidation.browserId(requestedBrowserId)
        }
        if (browserId == null) {
            sendAuthFailure(browserSession, msg.id, "INVALID_BROWSER_ID", "browserId 无效")
            return
        }
        val binding = registry.bindBrowser(browserSession, browserId, registered.playerName, server)
        val resumeToken = issueResumeToken(binding, server)
        browserSession.sendText(WsResponse.build(
            MessageTypes.AUTH_RESULT,
            msg.id,
            "success" to true,
            "serverName" to server.serverName,
            "serverId" to server.serverId,
            "workspaceId" to server.workspaceId,
            "browserId" to binding.browserId,
            "playerName" to binding.playerName,
            "resumeToken" to resumeToken,
            "negotiatedProtocol" to server.negotiatedProtocol.wireName,
            "sessionEpoch" to server.sessionEpoch,
            "relayCapabilities" to relayCapabilities(server.negotiatedProtocol, features),
            "onlineCount" to registry.getPresence(server.workspaceId).size,
            "permissions" to buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("*")) },
            "collaborators" to collaborators(binding)
        ))
        broadcastPresence(server.workspaceId)
    }

    private suspend fun handleResume(browserSession: RelaySocket, msg: WsMessage, resultType: String) {
        if (registry.getBrowserBinding(browserSession) != null) {
            browserSession.sendText(WsResponse.error(msg.id, "ALREADY_AUTHENTICATED", "连接已认证"))
            return
        }
        val rawToken = msg.data.jsonObject["resumeToken"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val resumeToken = RelayValidation.token(rawToken)
        if (resumeToken == null) {
            sendResumeFailure(browserSession, msg.id, resultType, "INVALID_RESUME_TOKEN", "Resume token 无效或已过期")
            return
        }
        val tokenHash = RelaySecrets.sha256(resumeToken)
        val record = sessionStore.lookup(tokenHash)
        if (record == null || record.expiresAt <= System.currentTimeMillis()) {
            sendResumeFailure(browserSession, msg.id, resultType, "INVALID_RESUME_TOKEN", "Resume token 无效或已过期")
            return
        }
        val server = registry.getServerForResume(record.workspaceId, record.serverId)
        if (server == null || server.licenseKey != record.licenseKey || server.serverKey != record.serverKey) {
            sendResumeFailure(browserSession, msg.id, resultType, "SERVER_OFFLINE", "游戏服务器已断开连接")
            return
        }
        val consumed = sessionStore.consume(tokenHash)
        if (consumed == null || consumed != record) {
            sendResumeFailure(browserSession, msg.id, resultType, "INVALID_RESUME_TOKEN", "Resume token 无效或已过期")
            return
        }
        val binding = registry.bindBrowser(browserSession, consumed.browserId, consumed.playerName, server)
        val rotatedToken = issueResumeToken(binding, server)
        browserSession.sendText(WsResponse.build(
            resultType,
            msg.id,
            "success" to true,
            "serverName" to server.serverName,
            "serverId" to server.serverId,
            "workspaceId" to server.workspaceId,
            "browserId" to binding.browserId,
            "playerName" to binding.playerName,
            "resumeToken" to rotatedToken,
            "negotiatedProtocol" to server.negotiatedProtocol.wireName,
            "sessionEpoch" to server.sessionEpoch,
            "relayCapabilities" to relayCapabilities(server.negotiatedProtocol, features),
            "onlineCount" to registry.getPresence(server.workspaceId).size,
            "collaborators" to collaborators(binding)
        ))
        broadcastPresence(server.workspaceId)
    }

    private suspend fun handlePresenceUpdate(browserSession: RelaySocket, msg: WsMessage) {
        val binding = registry.getBrowserBinding(browserSession)
        if (binding == null) {
            browserSession.sendText(WsResponse.error(msg.id, "NOT_AUTHENTICATED", "未认证，请先发送 auth 消息"))
            return
        }
        val rawCurrentFile = msg.data.jsonObject["currentFile"]?.jsonPrimitive?.contentOrNull
        val currentFile = if (rawCurrentFile.isNullOrEmpty()) {
            null
        } else {
            RelayValidation.path(rawCurrentFile) ?: run {
                browserSession.sendText(WsResponse.error(msg.id, "INVALID_PATH", "currentFile 无效"))
                return
            }
        }
        val updated = registry.updatePresence(browserSession, currentFile) ?: return
        if (msg.id.isNotEmpty()) {
            browserSession.sendText(WsResponse.build(MessageTypes.PRESENCE_UPDATE_RESULT, msg.id, "success" to true))
        }
        broadcastPresence(binding.workspaceId, updated)
    }

    private suspend fun issueResumeToken(binding: BrowserBinding, server: GameServer): String {
        val rawToken = RelaySecrets.newToken()
        sessionStore.save(
            RelaySecrets.sha256(rawToken),
            EditorSessionRecord(
                licenseKey = server.licenseKey,
                browserId = binding.browserId,
                playerName = binding.playerName,
                workspaceId = binding.workspaceId,
                serverKey = server.serverKey,
                serverId = binding.serverId,
                expiresAt = System.currentTimeMillis() + resumeTtlMillis
            )
        )
        return rawToken
    }

    private suspend fun forwardBrowserRequest(
        browserSession: RelaySocket,
        msg: WsMessage,
        expectedResponseType: String?
    ) {
        val binding = registry.getBrowserBinding(browserSession)
        if (binding == null) {
            browserSession.sendText(WsResponse.error(msg.id, "NOT_AUTHENTICATED", "未认证，请先发送 auth 消息"))
            return
        }
        if (msg.id.isEmpty()) {
            browserSession.sendText(WsResponse.error("", "MISSING_REQUEST_ID", "请求 ID 不能为空"))
            return
        }
        if (expectedResponseType == null) {
            browserSession.sendText(WsResponse.error(msg.id, "MISSING_RESPONSE_CONTRACT", "消息缺少响应契约"))
            return
        }
        if (binding.suspended) {
            browserSession.sendText(WsResponse.error(msg.id, "SERVER_OFFLINE", "游戏服务器已断开连接"))
            return
        }
        if (binding.protocolVersion == ProtocolVersion.V2 && isMutation(msg.type) && !features.v2WritesEnabled) {
            browserSession.sendText(WsResponse.error(msg.id, "FEATURE_DISABLED", "V2 变更路径尚未启用"))
            return
        }

        val data = msg.data.jsonObject
        if (msg.type == MessageTypes.MANIFEST_GET && data.isNotEmpty()) {
            browserSession.sendText(WsResponse.error(msg.id, "INVALID_MANIFEST_REQUEST", "manifest.get data 必须为空对象"))
            return
        }
        val rawPath = data["path"]?.jsonPrimitive?.contentOrNull
        val path = when {
            requiresPath(msg.type) -> RelayValidation.path(rawPath.orEmpty()) ?: run {
                browserSession.sendText(WsResponse.error(msg.id, "INVALID_PATH", "path 无效"))
                return
            }
            msg.type == MessageTypes.FILE_LIST && rawPath != null -> RelayValidation.path(rawPath) ?: run {
                browserSession.sendText(WsResponse.error(msg.id, "INVALID_PATH", "path 无效"))
                return
            }
            else -> null
        }
        var normalizedData = if (msg.type == MessageTypes.FILE_RENAME) {
            val oldPath = RelayValidation.path(data["oldPath"]?.jsonPrimitive?.contentOrNull.orEmpty())
            val newPath = RelayValidation.path(data["newPath"]?.jsonPrimitive?.contentOrNull.orEmpty())
            if (oldPath == null || newPath == null) {
                browserSession.sendText(WsResponse.error(msg.id, "INVALID_PATH", "oldPath 或 newPath 无效"))
                return
            }
            JsonObject(data + mapOf(
                "oldPath" to JsonPrimitive(oldPath),
                "newPath" to JsonPrimitive(newPath)
            ))
        } else if (path != null && rawPath != path) {
            JsonObject(data + ("path" to JsonPrimitive(path)))
        } else {
            data
        }

        val force = data["force"]?.jsonPrimitive?.booleanOrNull ?: false
        var v1BaseRevision: Long? = null
        if (msg.type == MessageTypes.FILE_WRITE) {
            when (binding.protocolVersion) {
                ProtocolVersion.V1 -> {
                    v1BaseRevision = data["baseRevision"]?.jsonPrimitive?.longOrNull
                    if (!force && v1BaseRevision == null) {
                        browserSession.sendText(WsResponse.error(msg.id, "MISSING_BASE_REVISION", "file.write 需要 Long baseRevision"))
                        return
                    }
                    normalizedData = JsonObject(normalizedData - "baseRevision" - "expectedRevision")
                }
                ProtocolVersion.V2 -> {
                    if (data["expectedRevision"] != null) {
                        browserSession.sendText(
                            WsResponse.error(msg.id, "INVALID_REVISION_FIELD", "浏览器 V2 file.write 只能发送 baseRevision")
                        )
                        return
                    }
                    val rawBaseRevision = data["baseRevision"]?.jsonPrimitive?.contentOrNull
                    val baseRevision = rawBaseRevision?.let(RelayValidation::sha256Revision)
                    if (rawBaseRevision != null && baseRevision == null) {
                        browserSession.sendText(WsResponse.error(msg.id, "INVALID_REVISION", "V2 revision 必须是 64 位小写 SHA-256"))
                        return
                    }
                    if (!force && baseRevision == null) {
                        browserSession.sendText(WsResponse.error(msg.id, "MISSING_BASE_REVISION", "file.write 需要 SHA-256 baseRevision"))
                        return
                    }
                    val forwardedData = normalizedData - "baseRevision" - "expectedRevision"
                    normalizedData = if (force || baseRevision == null) {
                        JsonObject(forwardedData)
                    } else {
                        JsonObject(forwardedData + ("expectedRevision" to JsonPrimitive(baseRevision)))
                    }
                }
            }
        }

        when (val reservation = registry.reserveRequest(
            browserSession = browserSession,
            originalId = msg.id,
            type = msg.type,
            expectedResponseType = expectedResponseType,
            path = path,
            v1BaseRevision = v1BaseRevision,
            force = force
        )) {
            RequestReservation.BrowserNotBound -> {
                browserSession.sendText(WsResponse.error(msg.id, "SERVER_OFFLINE", "游戏服务器已断开连接"))
            }
            RequestReservation.ServerOffline -> {
                browserSession.sendText(WsResponse.error(msg.id, "SERVER_OFFLINE", "游戏服务器已断开连接"))
            }
            is RequestReservation.Conflict -> {
                browserSession.sendText(WsResponse.build(
                    MessageTypes.ERROR,
                    msg.id,
                    "code" to "REVISION_CONFLICT",
                    "message" to "文件版本冲突",
                    "currentRevision" to reservation.currentRevision
                ))
            }
            is RequestReservation.Reserved -> {
                val request = reservation.request
                val forwarded = WsProtocol.encode(WsMessage(msg.type, request.relayId, normalizedData))
                try {
                    request.pluginSession.sendText(forwarded)
                } catch (_: Exception) {
                    registry.takePendingRequest(request.relayId, request.pluginSession)?.let {
                        registry.finishRequest(it, successfulWrite = false)
                    }
                    browserSession.sendText(WsResponse.error(msg.id, "SERVER_OFFLINE", "游戏服务器已断开连接"))
                }
            }
        }
    }

    suspend fun onBrowserDisconnect(browserSession: WebSocketSession) {
        val socket = registry.socket(browserSession)
        onBrowserDisconnect(socket)
        registry.releaseSocket(browserSession)
    }

    suspend fun onBrowserDisconnect(browserSession: RelaySocket) {
        val binding = registry.unbindBrowser(browserSession) ?: return
        broadcastPresence(binding.workspaceId)
    }

    private suspend fun broadcastPresence(workspaceId: String, updatedBinding: BrowserBinding? = null) {
        val users = buildJsonArray {
            registry.getPresence(workspaceId).forEach { binding ->
                val snapshot = updatedBinding?.takeIf { it.browserId == binding.browserId } ?: binding
                add(presenceMember(snapshot))
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

    private fun collaborators(binding: BrowserBinding) = buildJsonArray {
        registry.getPresence(binding.workspaceId)
            .filter { it.browserId != binding.browserId }
            .forEach { add(presenceMember(it)) }
    }

    private fun presenceMember(binding: BrowserBinding) = buildJsonObject {
        put("browserId", binding.browserId)
        put("playerName", binding.playerName)
        put("workspaceId", binding.workspaceId)
        if (binding.currentFile == null) {
            put("currentFile", kotlinx.serialization.json.JsonNull)
        } else {
            put("currentFile", binding.currentFile)
        }
        put("lastActiveAt", binding.lastActiveAt)
    }

    private suspend fun sendAuthFailure(session: RelaySocket, id: String, code: String, message: String) {
        session.sendText(WsResponse.build(MessageTypes.AUTH_RESULT, id, "success" to false, "code" to code, "message" to message))
    }

    private suspend fun sendResumeFailure(
        session: RelaySocket,
        id: String,
        resultType: String,
        code: String,
        message: String
    ) {
        session.sendText(WsResponse.build(resultType, id, "success" to false, "code" to code, "message" to message))
    }

    private fun requiresPath(type: String): Boolean = type in setOf(
        MessageTypes.FILE_READ,
        MessageTypes.FILE_WRITE,
        MessageTypes.FILE_CREATE,
        MessageTypes.FILE_DELETE,
    )

    private fun isMutation(type: String): Boolean = type in setOf(
        MessageTypes.FILE_WRITE,
        MessageTypes.FILE_CREATE,
        MessageTypes.FILE_DELETE,
        MessageTypes.FILE_RENAME,
        MessageTypes.RELOAD,
    )
}
