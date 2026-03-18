package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.WsMessage
import io.ktor.websocket.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap

class RelayHandler(private val registry: SessionRegistry) {
    private val json = Json { ignoreUnknownKeys = true }
    private val authenticatedBrowsers = ConcurrentHashMap.newKeySet<WebSocketSession>()

    suspend fun handleBrowserMessage(browserSession: WebSocketSession, text: String) {
        val msg = try {
            json.decodeFromString<WsMessage>(text)
        } catch (e: Exception) {
            browserSession.send("""{"type":"error","id":"","data":{"message":"消息格式错误: ${e.message}"}}""")
            return
        }

        if (msg.type == MessageTypes.AUTH) {
            handleAuth(browserSession, msg)
            return
        }

        if (browserSession !in authenticatedBrowsers) {
            browserSession.send("""{"type":"error","id":"${msg.id}","data":{"message":"未认证，请先发送 auth 消息"}}""")
            return
        }

        val server = registry.getServerForBrowser(browserSession)
        if (server == null) {
            browserSession.send("""{"type":"error","id":"${msg.id}","data":{"message":"游戏服务器已断开连接"}}""")
            return
        }

        try {
            server.session.send(text)
        } catch (e: Exception) {
            browserSession.send("""{"type":"error","id":"${msg.id}","data":{"message":"转发消息失败: ${e.message}"}}""")
        }
    }

    private suspend fun handleAuth(browserSession: WebSocketSession, msg: WsMessage) {
        val token = msg.data.jsonObject["token"]?.jsonPrimitive?.content ?: ""

        val server = registry.validateToken(token)
        if (server == null) {
            browserSession.send("""{"type":"auth.result","id":"${msg.id}","data":{"success":false,"message":"Token 无效或已过期"}}""")
            return
        }

        registry.bindBrowser(browserSession, server.serverKey)
        authenticatedBrowsers.add(browserSession)

        try {
            server.session.send(json.encodeToString(WsMessage.serializer(), msg))
        } catch (_: Exception) { }

        browserSession.send("""{"type":"auth.result","id":"${msg.id}","data":{"success":true,"serverName":"${server.serverName}","permissions":["*"]}}""")
    }

    fun onBrowserDisconnect(browserSession: WebSocketSession) {
        authenticatedBrowsers.remove(browserSession)
        registry.unbindBrowser(browserSession)
    }
}
