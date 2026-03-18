package com.orryx.editor.relay

import io.ktor.websocket.*
import java.util.concurrent.ConcurrentHashMap

/**
 * 已注册的游戏服务器
 */
data class GameServer(
    val serverKey: String,
    val serverName: String,
    val session: WebSocketSession,
    val registeredAt: Long = System.currentTimeMillis()
)

/**
 * 已注册的 Token
 */
data class RegisteredToken(
    val token: String,
    val serverKey: String,
    val playerName: String,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long
)

/**
 * 中心服务器的 Session 注册表
 *
 * 管理三种映射：
 * - serverKey → GameServer（插件端 WS 连接）
 * - token → RegisteredToken（token 到插件端的映射）
 * - browserSession → serverKey（浏览器到插件端的绑定）
 */
class SessionRegistry {

    // 插件端连接：serverKey → GameServer
    private val servers = ConcurrentHashMap<String, GameServer>()

    // Token 映射：token → RegisteredToken
    private val tokens = ConcurrentHashMap<String, RegisteredToken>()

    // 浏览器绑定：browserSession → serverKey
    private val browserBindings = ConcurrentHashMap<WebSocketSession, String>()

    // 反向映射：serverKey → 绑定到该服务器的所有浏览器 session
    private val serverBrowsers = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()

    // ---- 插件端管理 ----

    fun registerServer(serverKey: String, serverName: String, session: WebSocketSession): Boolean {
        // 如果已有同 key 的连接，踢掉旧的
        servers[serverKey]?.let { old ->
            // 旧连接会在 onDisconnect 中清理
        }
        servers[serverKey] = GameServer(serverKey, serverName, session)
        serverBrowsers.putIfAbsent(serverKey, ConcurrentHashMap.newKeySet())
        return true
    }

    fun unregisterServer(session: WebSocketSession) {
        val entry = servers.entries.find { it.value.session == session } ?: return
        val serverKey = entry.key
        servers.remove(serverKey)

        // 清理该服务器的所有 token
        tokens.entries.removeIf { it.value.serverKey == serverKey }

        // 清理绑定到该服务器的浏览器
        serverBrowsers.remove(serverKey)?.forEach { browserSession ->
            browserBindings.remove(browserSession)
        }
    }

    fun getServerBySession(session: WebSocketSession): GameServer? {
        return servers.values.find { it.session == session }
    }

    // ---- Token 管理 ----

    fun registerToken(token: String, serverKey: String, playerName: String, expiresIn: Long): Boolean {
        if (!servers.containsKey(serverKey)) return false
        tokens[token] = RegisteredToken(
            token = token,
            serverKey = serverKey,
            playerName = playerName,
            expiresAt = System.currentTimeMillis() + expiresIn
        )
        return true
    }

    fun revokeToken(token: String) {
        tokens.remove(token)
    }

    /**
     * 验证 token 并返回对应的 GameServer
     * 验证成功后 token 不会被消费（允许断线重连复用）
     */
    fun validateToken(token: String): GameServer? {
        val registered = tokens[token] ?: return null
        if (System.currentTimeMillis() > registered.expiresAt) {
            tokens.remove(token)
            return null
        }
        return servers[registered.serverKey]
    }

    fun getTokenEntry(token: String): RegisteredToken? = tokens[token]

    // ---- 浏览器绑定 ----

    fun bindBrowser(browserSession: WebSocketSession, serverKey: String) {
        browserBindings[browserSession] = serverKey
        serverBrowsers[serverKey]?.add(browserSession)
    }

    fun unbindBrowser(browserSession: WebSocketSession) {
        val serverKey = browserBindings.remove(browserSession) ?: return
        serverBrowsers[serverKey]?.remove(browserSession)
    }

    fun getServerForBrowser(browserSession: WebSocketSession): GameServer? {
        val serverKey = browserBindings[browserSession] ?: return null
        return servers[serverKey]
    }

    fun getBrowsersForServer(serverKey: String): Set<WebSocketSession> {
        return serverBrowsers[serverKey] ?: emptySet()
    }

    // ---- 统计 ----

    fun serverCount(): Int = servers.size
    fun tokenCount(): Int = tokens.size
    fun browserCount(): Int = browserBindings.size

    fun isServerOnline(serverKey: String): Boolean = servers.containsKey(serverKey)

    fun getOnlineServerKeys(): Set<String> = servers.keys.toSet()
}
