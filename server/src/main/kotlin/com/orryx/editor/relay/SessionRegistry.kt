package com.orryx.editor.relay

import io.ktor.websocket.*
import java.util.concurrent.ConcurrentHashMap

data class GameServer(
    val serverKey: String,
    val serverName: String,
    val session: WebSocketSession,
    val registeredAt: Long = System.currentTimeMillis()
)

data class RegisteredToken(
    val token: String,
    val serverKey: String,
    val playerName: String,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long
)

class SessionRegistry {

    // 同一个 serverKey 可以有多个 session（多服共用 license）
    // session → GameServer
    private val sessions = ConcurrentHashMap<WebSocketSession, GameServer>()

    // serverKey → 该 key 下所有 session
    private val serverSessions = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()

    private val tokens = ConcurrentHashMap<String, RegisteredToken>()
    private val browserBindings = ConcurrentHashMap<WebSocketSession, String>()
    private val serverBrowsers = ConcurrentHashMap<String, MutableSet<WebSocketSession>>()

    // ---- 插件端管理 ----

    fun registerServer(serverKey: String, serverName: String, session: WebSocketSession) {
        val server = GameServer(serverKey, serverName, session)
        sessions[session] = server
        serverSessions.getOrPut(serverKey) { ConcurrentHashMap.newKeySet() }.add(session)
        serverBrowsers.putIfAbsent(serverKey, ConcurrentHashMap.newKeySet())
    }

    fun unregisterServer(session: WebSocketSession) {
        val server = sessions.remove(session) ?: return
        val serverKey = server.serverKey
        serverSessions[serverKey]?.remove(session)

        // 如果该 serverKey 下没有任何 session 了，清理 token 和浏览器绑定
        if (serverSessions[serverKey].isNullOrEmpty()) {
            serverSessions.remove(serverKey)
            tokens.entries.removeIf { it.value.serverKey == serverKey }
            serverBrowsers.remove(serverKey)?.forEach { browserSession ->
                browserBindings.remove(browserSession)
            }
        }
    }

    fun getServerBySession(session: WebSocketSession): GameServer? = sessions[session]

    /** 获取该 serverKey 下所有在线的插件端 session */
    fun getServerSessions(serverKey: String): Set<WebSocketSession> {
        return serverSessions[serverKey] ?: emptySet()
    }

    /** 获取该 serverKey 下任意一个 GameServer（用于读取 serverName 等信息） */
    fun getAnyServer(serverKey: String): GameServer? {
        return serverSessions[serverKey]?.firstOrNull()?.let { sessions[it] }
    }

    // ---- Token 管理 ----

    fun registerToken(token: String, serverKey: String, playerName: String, expiresIn: Long): Boolean {
        // 只要该 serverKey 下有至少一个在线 session 就允许注册
        if (serverSessions[serverKey].isNullOrEmpty()) return false
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

    fun validateToken(token: String): GameServer? {
        val registered = tokens[token] ?: return null
        if (System.currentTimeMillis() > registered.expiresAt) {
            tokens.remove(token)
            return null
        }
        // 返回该 serverKey 下任意一个在线 server
        return getAnyServer(registered.serverKey)
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

    /** 获取浏览器绑定的 serverKey */
    fun getServerKeyForBrowser(browserSession: WebSocketSession): String? {
        return browserBindings[browserSession]
    }

    fun getBrowsersForServer(serverKey: String): Set<WebSocketSession> {
        return serverBrowsers[serverKey] ?: emptySet()
    }

    // ---- 统计 ----

    fun serverCount(): Int = sessions.size
    fun tokenCount(): Int = tokens.size
    fun browserCount(): Int = browserBindings.size

    fun isServerOnline(serverKey: String): Boolean = !serverSessions[serverKey].isNullOrEmpty()

    fun onlineSessionCount(serverKey: String): Int = serverSessions[serverKey]?.size ?: 0

    fun getOnlineServerKeys(): Set<String> = serverSessions.keys.filter { !serverSessions[it].isNullOrEmpty() }.toSet()
}
