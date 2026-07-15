package com.orryx.editor.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

@Serializable
data class WsMessage(
    val type: String,
    val id: String,
    val data: JsonElement
)

@Serializable
data class ServerRegisterData(
    val license: String,
    val serverName: String,
    val serverId: String? = null,
    val pluginVersion: String? = null,
    val protocolVersions: List<String>? = null,
    val preferredProtocol: String? = null,
    val capabilities: List<String>? = null,
    val connectionNonce: String? = null
)

@Serializable
data class ServerRegisterResultData(
    val success: Boolean,
    val serverKey: String? = null,
    val serverId: String? = null,
    val workspaceId: String? = null,
    val negotiatedProtocol: String? = null,
    val sessionEpoch: Long? = null,
    val relayCapabilities: List<String> = emptyList(),
    val connectionNonce: String? = null,
    val code: String? = null,
    val message: String? = null
)

@Serializable
data class ManifestSnapshotFile(
    val path: String,
    val revision: String,
    val size: Long? = null
)

@Serializable
data class ManifestSnapshotData(
    val manifestId: String,
    val revision: String,
    val files: List<ManifestSnapshotFile>,
    val createdAt: Long? = null
)

@Serializable
enum class ReleaseAction {
    PREPARE,
    COMMIT,
    STATUS,
    ROLLBACK;

    val wireName: String
        get() = name.lowercase()
}

@Serializable
enum class ReleasePluginState {
    PREPARING,
    PREPARED,
    COMMITTING,
    READINESS_PENDING,
    READY,
    ROLLING_BACK,
    ROLLED_BACK,
    FAILED,
    RECOVERY_REQUIRED
}

@Serializable
data class ReleaseRequestData(
    val action: String,
    val transactionId: String,
    val releaseId: String,
    val commandId: String,
    val canonicalVersion: String? = null,
    val canonicalPayloadSha256: String? = null,
    val signingKeyId: String? = null,
    val signature: String? = null,
    val expectedManifestRevision: String? = null,
    val targetManifestRevision: String? = null,
    val fileCount: Int? = null,
    val totalBytes: Long? = null,
    val operationsUrl: String? = null,
    val transferToken: String? = null,
    val transferExpiresAt: Long? = null,
    val readinessDeadline: Long? = null,
    val reason: String? = null
)

@Serializable
data class ReleaseResultData(
    val action: String,
    val transactionId: String,
    val releaseId: String,
    val commandId: String,
    val success: Boolean,
    val pluginState: ReleasePluginState,
    val eventId: String,
    val eventSeq: Long,
    val observedManifestRevision: String? = null,
    val resultManifestRevision: String? = null,
    val errorCode: String? = null,
    val message: String? = null
)

object ProtocolLimits {
    const val MAX_FRAME_BYTES = 1_048_576
    const val MAX_MESSAGE_TYPE_LENGTH = 64
    const val MAX_REQUEST_ID_LENGTH = 128
    const val MAX_TOKEN_LENGTH = 512
    const val MIN_TOKEN_LENGTH = 8
    const val MAX_PATH_LENGTH = 2_048
    const val MAX_SERVER_NAME_LENGTH = 100
    const val MAX_SERVER_ID_LENGTH = 128
    const val MAX_BROWSER_ID_LENGTH = 128
    const val MAX_PLAYER_NAME_LENGTH = 100
    const val MAX_PLUGIN_VERSION_LENGTH = 64
    const val MAX_CAPABILITY_LENGTH = 64
    const val MAX_CAPABILITIES = 64
    const val MAX_CONNECTION_NONCE_LENGTH = 128
    const val MAX_MANIFEST_ID_LENGTH = 128
    const val MAX_MANIFEST_FILES = 4_096
}

data class ProtocolError(val code: String, val message: String)

sealed interface MessageParseResult {
    data class Success(val message: WsMessage) : MessageParseResult
    data class Failure(val error: ProtocolError) : MessageParseResult
}

enum class ProtocolRole {
    BROWSER,
    PLUGIN,
    RELAY
}

enum class MessageDirection {
    BROWSER_TO_RELAY,
    PLUGIN_TO_RELAY,
    RELAY_TO_BROWSER,
    RELAY_TO_PLUGIN
}

enum class ProtocolVersion(val wireName: String) {
    V1("v1"),
    V2("v2");

    companion object {
        fun parse(value: String?): ProtocolVersion? = when (value?.trim()?.lowercase()) {
            "1", "v1" -> V1
            "2", "v2" -> V2
            else -> null
        }
    }
}

data class MessageContract(
    val type: String,
    val direction: MessageDirection,
    val versions: Set<ProtocolVersion>,
    val expectedResponseType: String? = null
)

sealed interface ContractValidationResult {
    data class Allowed(val contract: MessageContract) : ContractValidationResult
    data class Rejected(val error: ProtocolError) : ContractValidationResult
}

/**
 * Protocol hard allowlist. A syntactically valid type is not routable unless a contract below
 * explicitly allows the connection role, direction and negotiated protocol version.
 */
object ProtocolContracts {
    private val both = setOf(ProtocolVersion.V1, ProtocolVersion.V2)
    private val v2Only = setOf(ProtocolVersion.V2)

    private fun browserRequest(
        type: String,
        response: String? = null,
        versions: Set<ProtocolVersion> = both
    ) = MessageContract(type, MessageDirection.BROWSER_TO_RELAY, versions, response)

    private fun pluginMessage(type: String, versions: Set<ProtocolVersion> = both) =
        MessageContract(type, MessageDirection.PLUGIN_TO_RELAY, versions)

    private fun relayToPlugin(type: String, versions: Set<ProtocolVersion> = both) =
        MessageContract(type, MessageDirection.RELAY_TO_PLUGIN, versions)

    private fun relayToBrowser(type: String, versions: Set<ProtocolVersion> = both) =
        MessageContract(type, MessageDirection.RELAY_TO_BROWSER, versions)

    private val contracts = listOf(
        browserRequest(MessageTypes.AUTH, MessageTypes.AUTH_RESULT),
        browserRequest(MessageTypes.RESUME, MessageTypes.RESUME_RESULT),
        browserRequest(MessageTypes.FILE_LIST, MessageTypes.FILE_TREE),
        browserRequest(MessageTypes.FILE_READ, MessageTypes.FILE_CONTENT),
        browserRequest(MessageTypes.FILE_WRITE, MessageTypes.FILE_WRITTEN),
        browserRequest(MessageTypes.FILE_CREATE, MessageTypes.FILE_WRITTEN),
        browserRequest(MessageTypes.FILE_DELETE, MessageTypes.FILE_WRITTEN),
        browserRequest(MessageTypes.FILE_RENAME, MessageTypes.FILE_WRITTEN),
        browserRequest(MessageTypes.RELOAD, MessageTypes.RELOAD_RESULT),
        browserRequest(MessageTypes.LOG_SUBSCRIBE, MessageTypes.LOG_SUBSCRIBE_RESULT),
        browserRequest(MessageTypes.LOG_UNSUBSCRIBE, MessageTypes.LOG_UNSUBSCRIBE_RESULT),
        browserRequest(MessageTypes.PRESENCE_UPDATE, MessageTypes.PRESENCE_UPDATE_RESULT),
        browserRequest(MessageTypes.MANIFEST_GET, MessageTypes.MANIFEST_SNAPSHOT, v2Only),

        pluginMessage(MessageTypes.SERVER_REGISTER),
        pluginMessage(MessageTypes.TOKEN_REGISTER),
        pluginMessage(MessageTypes.TOKEN_REVOKE),
        pluginMessage(MessageTypes.FILE_TREE),
        pluginMessage(MessageTypes.FILE_CONTENT),
        pluginMessage(MessageTypes.FILE_WRITTEN),
        pluginMessage(MessageTypes.FILE_CHANGED),
        pluginMessage(MessageTypes.RELOAD_RESULT),
        pluginMessage(MessageTypes.LOG_SUBSCRIBE_RESULT),
        pluginMessage(MessageTypes.LOG_UNSUBSCRIBE_RESULT),
        pluginMessage(MessageTypes.LOG_ENTRY),
        pluginMessage(MessageTypes.SERVER_INFO),
        pluginMessage(MessageTypes.MANIFEST_SNAPSHOT, v2Only),
        pluginMessage(MessageTypes.RELEASE_RESULT, v2Only),
        pluginMessage(MessageTypes.ERROR),
        relayToPlugin(MessageTypes.SERVER_REGISTER_RESULT),
        MessageContract(MessageTypes.TOKEN_REGISTER_RESULT, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.TOKEN_REVOKE_RESULT, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.ERROR, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_LIST, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_READ, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_WRITE, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_CREATE, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_DELETE, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.FILE_RENAME, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.RELOAD, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.LOG_SUBSCRIBE, MessageDirection.RELAY_TO_PLUGIN, both),
        MessageContract(MessageTypes.LOG_UNSUBSCRIBE, MessageDirection.RELAY_TO_PLUGIN, both),
        relayToPlugin(MessageTypes.MANIFEST_GET, v2Only),
        relayToPlugin(MessageTypes.RELEASE_REQUEST, v2Only),

        relayToBrowser(MessageTypes.AUTH_RESULT),
        relayToBrowser(MessageTypes.RESUME_RESULT),
        relayToBrowser(MessageTypes.FILE_TREE),
        relayToBrowser(MessageTypes.FILE_CONTENT),
        relayToBrowser(MessageTypes.FILE_WRITTEN),
        relayToBrowser(MessageTypes.FILE_CHANGED),
        relayToBrowser(MessageTypes.PRESENCE_UPDATE_RESULT),
        relayToBrowser(MessageTypes.PRESENCE_UPDATED),
        relayToBrowser(MessageTypes.RELOAD_RESULT),
        relayToBrowser(MessageTypes.LOG_SUBSCRIBE_RESULT),
        relayToBrowser(MessageTypes.LOG_UNSUBSCRIBE_RESULT),
        relayToBrowser(MessageTypes.LOG_ENTRY),
        relayToBrowser(MessageTypes.SERVER_INFO),
        relayToBrowser(MessageTypes.MANIFEST_SNAPSHOT, v2Only),
        relayToBrowser(MessageTypes.ERROR)
    )

    private val byType = contracts.groupBy(MessageContract::type)

    fun validate(
        type: String,
        role: ProtocolRole,
        direction: MessageDirection,
        version: ProtocolVersion
    ): ContractValidationResult {
        val typeContracts = byType[type]
            ?: return ContractValidationResult.Rejected(ProtocolError("UNKNOWN_MESSAGE_TYPE", "未知消息类型"))
        val roleMatchesDirection = when (role) {
            ProtocolRole.BROWSER -> direction == MessageDirection.BROWSER_TO_RELAY
            ProtocolRole.PLUGIN -> direction == MessageDirection.PLUGIN_TO_RELAY
            ProtocolRole.RELAY -> direction == MessageDirection.RELAY_TO_BROWSER || direction == MessageDirection.RELAY_TO_PLUGIN
        }
        if (!roleMatchesDirection) {
            return ContractValidationResult.Rejected(ProtocolError("MESSAGE_DIRECTION_NOT_ALLOWED", "消息方向不允许"))
        }
        val directionContracts = typeContracts.filter { it.direction == direction }
        if (directionContracts.isEmpty()) {
            return ContractValidationResult.Rejected(ProtocolError("MESSAGE_DIRECTION_NOT_ALLOWED", "消息方向不允许"))
        }
        val contract = directionContracts.firstOrNull { version in it.versions }
            ?: return ContractValidationResult.Rejected(ProtocolError("MESSAGE_NOT_SUPPORTED", "协商协议不支持该消息"))
        return ContractValidationResult.Allowed(contract)
    }

    fun expectedResponseType(type: String, version: ProtocolVersion): String? =
        contracts.firstOrNull {
            it.type == type && it.direction == MessageDirection.BROWSER_TO_RELAY && version in it.versions
        }?.expectedResponseType

    fun allowedTypes(direction: MessageDirection, version: ProtocolVersion): Set<String> =
        contracts.asSequence()
            .filter { it.direction == direction && version in it.versions }
            .map(MessageContract::type)
            .toSet()
}

object WsProtocol {
    private val json = Json { ignoreUnknownKeys = true }
    private val typePattern = Regex("^[a-z][a-z0-9._-]{0,63}$")

    fun parse(text: String): MessageParseResult {
        if (text.toByteArray(Charsets.UTF_8).size > ProtocolLimits.MAX_FRAME_BYTES) {
            return MessageParseResult.Failure(ProtocolError("FRAME_TOO_LARGE", "消息帧过大"))
        }
        val message = try {
            json.decodeFromString<WsMessage>(text)
        } catch (_: Exception) {
            return MessageParseResult.Failure(ProtocolError("INVALID_MESSAGE", "消息格式无效"))
        }
        if (!typePattern.matches(message.type) || message.type.length > ProtocolLimits.MAX_MESSAGE_TYPE_LENGTH) {
            return MessageParseResult.Failure(ProtocolError("INVALID_TYPE", "消息类型无效"))
        }
        if (message.id.length > ProtocolLimits.MAX_REQUEST_ID_LENGTH || message.id.any(Char::isISOControl)) {
            return MessageParseResult.Failure(ProtocolError("INVALID_REQUEST_ID", "请求 ID 无效"))
        }
        if (message.data !is JsonObject) {
            return MessageParseResult.Failure(ProtocolError("INVALID_DATA", "data 必须是对象"))
        }
        return MessageParseResult.Success(message)
    }

    fun encode(message: WsMessage): String = json.encodeToString(WsMessage.serializer(), message)
}

/** 安全构建 WebSocket JSON 响应（避免字符串拼接导致的 JSON 注入） */
object WsResponse {
    private val json = Json { encodeDefaults = true }

    fun build(type: String, id: String, vararg pairs: Pair<String, Any?>): String {
        return json.encodeToString(JsonObject.serializer(), buildJsonObject {
            put("type", type)
            put("id", id)
            putJsonObject("data") {
                for ((key, value) in pairs) {
                    when (value) {
                        is String -> put(key, value)
                        is Boolean -> put(key, value)
                        is Int -> put(key, value)
                        is Long -> put(key, value)
                        is JsonElement -> put(key, value)
                        null -> put(key, JsonNull)
                        else -> put(key, value.toString())
                    }
                }
            }
        })
    }

    fun error(id: String, code: String, message: String): String =
        build(MessageTypes.ERROR, id, "code" to code, "message" to message)
}

object MessageTypes {
    // 浏览器 → relay
    const val AUTH = "auth"
    const val RESUME = "session.resume"
    const val FILE_LIST = "file.list"
    const val FILE_READ = "file.read"
    const val FILE_WRITE = "file.write"
    const val FILE_CREATE = "file.create"
    const val FILE_DELETE = "file.delete"
    const val FILE_RENAME = "file.rename"
    const val RELOAD = "reload"
    const val LOG_SUBSCRIBE = "log.subscribe"
    const val LOG_UNSUBSCRIBE = "log.unsubscribe"
    const val PRESENCE_UPDATE = "presence.update"
    const val MANIFEST_GET = "manifest.get"

    // 插件 → relay 控制消息
    const val SERVER_REGISTER = "server.register"
    const val SERVER_REGISTER_RESULT = "server.register.result"
    const val TOKEN_REGISTER = "token.register"
    const val TOKEN_REGISTER_RESULT = "token.register.result"
    const val TOKEN_REVOKE = "token.revoke"
    const val TOKEN_REVOKE_RESULT = "token.revoke.result"

    // relay / 插件 → 浏览器
    const val AUTH_RESULT = "auth.result"
    const val RESUME_RESULT = "session.resume.result"
    const val FILE_TREE = "file.tree"
    const val FILE_CONTENT = "file.content"
    const val FILE_WRITTEN = "file.written"
    const val FILE_CHANGED = "file.changed"
    const val PRESENCE_UPDATE_RESULT = "presence.update.result"
    const val PRESENCE_UPDATED = "presence.updated"
    const val RELOAD_RESULT = "reload.result"
    const val LOG_SUBSCRIBE_RESULT = "log.subscribe.result"
    const val LOG_UNSUBSCRIBE_RESULT = "log.unsubscribe.result"
    const val LOG_ENTRY = "log.entry"
    const val SERVER_INFO = "server.info"
    const val ERROR = "error"

    // Manifest and release control routes are V2-only.
    const val MANIFEST_SNAPSHOT = "manifest.snapshot"
    const val RELEASE_REQUEST = "release.request"
    const val RELEASE_RESULT = "release.result"
}
