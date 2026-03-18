package com.orryx.editor.relay

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.protocol.WsMessage
import io.ktor.websocket.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.util.concurrent.ConcurrentHashMap

class ServerEndpoint(
    private val registry: SessionRegistry,
    private val licenseManager: LicenseManager
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val sessionIps = ConcurrentHashMap<WebSocketSession, String>()

    fun onServerConnect(session: WebSocketSession, remoteIp: String) {
        sessionIps[session] = remoteIp
    }

    suspend fun handleServerMessage(serverSession: WebSocketSession, text: String) {
        val msg = try {
            json.decodeFromString<WsMessage>(text)
        } catch (e: Exception) {
            serverSession.send("""{"type":"error","id":"","data":{"message":"消息格式错误: ${e.message}"}}""")
            return
        }

        when (msg.type) {
            "server.register" -> handleRegister(serverSession, msg)
            "token.register" -> handleTokenRegister(serverSession, msg)
            "token.revoke" -> handleTokenRevoke(serverSession, msg)
            else -> relayToBoundBrowsers(serverSession, text)
        }
    }

    private suspend fun handleRegister(session: WebSocketSession, msg: WsMessage) {
        val data = msg.data.jsonObject
        val license = data["license"]?.jsonPrimitive?.content ?: ""
        val name = data["serverName"]?.jsonPrimitive?.content ?: "Unknown"

        if (license.isEmpty()) {
            session.send("""{"type":"server.register.result","id":"${msg.id}","data":{"success":false,"message":"缺少 license"}}""")
            return
        }

        val connectIp = sessionIps[session] ?: ""
        val entry = licenseManager.validate(license, connectIp)
        if (entry == null) {
            val raw = licenseManager.get(license)
            val reason = when {
                raw == null -> "license 不存在"
                !raw.enabled -> "license 已禁用"
                raw.isExpired() -> "license 已过期"
                !raw.isIpAllowed(connectIp) -> "IP 不在允许列表 (当前: $connectIp)"
                else -> "license 无效"
            }
            session.send("""{"type":"server.register.result","id":"${msg.id}","data":{"success":false,"message":"$reason"}}""")
            return
        }

        // 自动将新 IP 添加到允许列表
        if (connectIp.isNotEmpty() && connectIp !in entry.boundIps) {
            licenseManager.addIp(license, connectIp)
        }

        registry.registerServer(entry.serverKey, name, session)
        session.send("""{"type":"server.register.result","id":"${msg.id}","data":{"success":true,"serverKey":"${entry.serverKey}","message":"已注册: $name"}}""")
    }

    private suspend fun handleTokenRegister(session: WebSocketSession, msg: WsMessage) {
        val server = registry.getServerBySession(session)
        if (server == null) {
            session.send("""{"type":"error","id":"${msg.id}","data":{"message":"请先发送 server.register"}}""")
            return
        }

        val data = msg.data.jsonObject
        val token = data["token"]?.jsonPrimitive?.content ?: ""
        val playerName = data["playerName"]?.jsonPrimitive?.content ?: ""
        val expiresIn = data["expiresIn"]?.jsonPrimitive?.long ?: 300_000L

        if (token.isEmpty()) {
            session.send("""{"type":"error","id":"${msg.id}","data":{"message":"token 不能为空"}}""")
            return
        }

        registry.registerToken(token, server.serverKey, playerName, expiresIn)
        session.send("""{"type":"token.register.result","id":"${msg.id}","data":{"success":true,"token":"$token"}}""")
    }

    private suspend fun handleTokenRevoke(session: WebSocketSession, msg: WsMessage) {
        val token = msg.data.jsonObject["token"]?.jsonPrimitive?.content ?: ""
        registry.revokeToken(token)
        session.send("""{"type":"token.revoke.result","id":"${msg.id}","data":{"success":true}}""")
    }

    private suspend fun relayToBoundBrowsers(serverSession: WebSocketSession, text: String) {
        val server = registry.getServerBySession(serverSession) ?: return
        val browsers = registry.getBrowsersForServer(server.serverKey)
        for (browser in browsers) {
            try { browser.send(text) } catch (_: Exception) { }
        }
    }

    fun onServerDisconnect(session: WebSocketSession) {
        sessionIps.remove(session)
        registry.unregisterServer(session)
    }
}
