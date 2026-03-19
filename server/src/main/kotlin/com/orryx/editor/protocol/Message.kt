package com.orryx.editor.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class WsMessage(
    val type: String,
    val id: String,
    val data: JsonElement
)

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
}

object MessageTypes {
    // 前端 → 服务器
    const val AUTH = "auth"
    const val FILE_LIST = "file.list"
    const val FILE_READ = "file.read"
    const val FILE_WRITE = "file.write"
    const val FILE_CREATE = "file.create"
    const val FILE_DELETE = "file.delete"
    const val FILE_RENAME = "file.rename"
    const val RELOAD = "reload"
    const val LOG_SUBSCRIBE = "log.subscribe"
    const val LOG_UNSUBSCRIBE = "log.unsubscribe"

    // 服务器 → 前端
    const val AUTH_RESULT = "auth.result"
    const val FILE_TREE = "file.tree"
    const val FILE_CONTENT = "file.content"
    const val FILE_WRITTEN = "file.written"
    const val RELOAD_RESULT = "reload.result"
    const val LOG_ENTRY = "log.entry"
    const val SERVER_INFO = "server.info"
    const val ERROR = "error"
}
