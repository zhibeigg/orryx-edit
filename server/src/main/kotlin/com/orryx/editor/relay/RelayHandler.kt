package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.WsMessage
import com.orryx.editor.protocol.WsResponse
import io.ktor.websocket.*
import kotlinx.serialization.json.*
import java.util.concurrent.ConcurrentHashMap

class RelayHandler(private val registry: SessionRegistry) {
    private val json = Json { ignoreUnknownKeys = true }
    private val authenticatedBrowsers = ConcurrentHashMap.newKeySet<WebSocketSession>()

    suspend fun handleBrowserMessage(browserSession: WebSocketSession, text: String) {
        val msg = try {
            json.decodeFromString<WsMessage>(text)
        } catch (e: Exception) {
            browserSession.send(WsResponse.build("error", "", "message" to "消息格式错误: ${e.message}"))
            return
        }

        if (msg.type == MessageTypes.AUTH) {
            handleAuth(browserSession, msg)
            return
        }

        if (browserSession !in authenticatedBrowsers) {
            browserSession.send(WsResponse.build("error", msg.id, "message" to "未认证，请先发送 auth 消息"))
            return
        }

        // 透传给该 serverKey 下所有在线的插件端
        val serverKey = registry.getServerKeyForBrowser(browserSession)
        if (serverKey == null) {
            browserSession.send(WsResponse.build("error", msg.id, "message" to "游戏服务器已断开连接"))
            return
        }

        val sessions = registry.getServerSessions(serverKey)
        if (sessions.isEmpty()) {
            browserSession.send(WsResponse.build("error", msg.id, "message" to "游戏服务器已断开连接"))
            return
        }

        for (session in sessions) {
            try { session.send(text) } catch (_: Exception) { }
        }
    }

    private suspend fun handleAuth(browserSession: WebSocketSession, msg: WsMessage) {
        val token = msg.data.jsonObject["token"]?.jsonPrimitive?.content ?: ""

        val server = registry.validateToken(token)
        if (server == null) {
            browserSession.send(WsResponse.build("auth.result", msg.id, "success" to false, "message" to "Token 无效或已过期"))
            return
        }

        registry.bindBrowser(browserSession, server.serverKey)
        authenticatedBrowsers.add(browserSession)

        // 通知所有插件端有浏览器连接了
        val sessions = registry.getServerSessions(server.serverKey)
        for (session in sessions) {
            try { session.send(json.encodeToString(WsMessage.serializer(), msg)) } catch (_: Exception) { }
        }

        val onlineCount = registry.onlineSessionCount(server.serverKey)
        val permissions = buildJsonArray { add("*") }
        browserSession.send(WsResponse.build(
            "auth.result", msg.id,
            "success" to true,
            "serverName" to server.serverName,
            "onlineCount" to onlineCount,
            "permissions" to permissions
        ))
    }

    fun onBrowserDisconnect(browserSession: WebSocketSession) {
        authenticatedBrowsers.remove(browserSession)
        registry.unbindBrowser(browserSession)
    }
}
