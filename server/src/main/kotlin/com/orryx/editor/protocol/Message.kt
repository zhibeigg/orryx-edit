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
}

data class ProtocolError(val code: String, val message: String)

sealed interface MessageParseResult {
    data class Success(val message: WsMessage) : MessageParseResult
    data class Failure(val error: ProtocolError) : MessageParseResult
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

    // relay / 插件 → 浏览器
    const val AUTH_RESULT = "auth.result"
    const val RESUME_RESULT = "session.resume.result"
    const val FILE_TREE = "file.tree"
    const val FILE_CONTENT = "file.content"
    const val FILE_WRITTEN = "file.written"
    const val FILE_CHANGED = "file.changed"
    const val PRESENCE_UPDATED = "presence.updated"
    const val RELOAD_RESULT = "reload.result"
    const val LOG_ENTRY = "log.entry"
    const val SERVER_INFO = "server.info"
    const val ERROR = "error"
}
