package com.orryx.editor.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class WsMessage(
    val type: String,
    val id: String,
    val data: JsonElement
)

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
