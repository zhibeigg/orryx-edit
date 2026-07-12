package com.orryx.editor.relay

import io.ktor.websocket.WebSocketSession
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.ConcurrentHashMap

private const val DEFAULT_REQUEST_TIMEOUT_MILLIS = 30_000L

data class GameServer(
    val licenseKey: String,
    val serverKey: String,
    val serverName: String,
    val serverId: String,
    val workspaceId: String,
    val session: RelaySocket,
    val registeredAt: Long = System.currentTimeMillis()
)

data class RegisteredToken(
    val tokenHash: String,
    val pluginSession: RelaySocket,
    val serverId: String,
    val workspaceId: String,
    val playerName: String,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long
)

data class BrowserBinding(
    val browserId: String,
    val playerName: String,
    val workspaceId: String,
    val serverId: String,
    val pluginSession: RelaySocket,
    val browserSession: RelaySocket,
    val currentFile: String? = null,
    val lastActiveAt: Long = System.currentTimeMillis()
)

data class PendingRequest(
    val relayId: String,
    val originalId: String,
    val type: String,
    val browserSession: RelaySocket,
    val pluginSession: RelaySocket,
    val workspaceId: String,
    val browserId: String,
    val path: String?,
    val writeLock: Mutex?,
    val createdAt: Long = System.currentTimeMillis()
)

sealed interface RequestReservation {
    data class Reserved(val request: PendingRequest) : RequestReservation
    data class Conflict(val currentRevision: Long) : RequestReservation
    data object BrowserNotBound : RequestReservation
}

private data class RevisionKey(val workspaceId: String, val path: String)

class SessionRegistry(
    private val requestTimeoutMillis: Long = DEFAULT_REQUEST_TIMEOUT_MILLIS
) {
    private val ktorSockets = ConcurrentHashMap<WebSocketSession, KtorRelaySocket>()
    private val sessions = ConcurrentHashMap<RelaySocket, GameServer>()
    private val serverSessions = ConcurrentHashMap<String, MutableSet<RelaySocket>>()
    private val workspaceSessions = ConcurrentHashMap<String, MutableSet<RelaySocket>>()
    private val tokens = ConcurrentHashMap<String, RegisteredToken>()
    private val browserBindings = ConcurrentHashMap<RelaySocket, BrowserBinding>()
    private val workspaceBrowsers = ConcurrentHashMap<String, MutableSet<RelaySocket>>()
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    private val revisions = ConcurrentHashMap<RevisionKey, Long>()
    private val revisionLocks = ConcurrentHashMap<RevisionKey, Mutex>()

    fun socket(session: WebSocketSession): RelaySocket =
        ktorSockets.computeIfAbsent(session) { KtorRelaySocket(it) }

    fun releaseSocket(session: WebSocketSession) {
        ktorSockets.remove(session)
    }

    fun registerServer(
        licenseKey: String,
        serverKey: String,
        serverName: String,
        serverId: String,
        session: RelaySocket
    ): GameServer {
        unregisterServer(session)
        val server = GameServer(
            licenseKey = licenseKey,
            serverKey = serverKey,
            serverName = serverName,
            serverId = serverId,
            workspaceId = RelaySecrets.workspaceId(serverKey, serverId),
            session = session
        )
        sessions[session] = server
        serverSessions.computeIfAbsent(serverKey) { ConcurrentHashMap.newKeySet() }.add(session)
        workspaceSessions.computeIfAbsent(server.workspaceId) { ConcurrentHashMap.newKeySet() }.add(session)
        workspaceBrowsers.computeIfAbsent(server.workspaceId) { ConcurrentHashMap.newKeySet() }
        return server
    }

    fun registerServer(serverKey: String, serverName: String, serverId: String, session: RelaySocket): GameServer =
        registerServer(serverKey, serverKey, serverName, serverId, session)

    fun registerServer(serverKey: String, serverName: String, session: RelaySocket): GameServer =
        registerServer(serverKey, serverKey, serverName, serverName, session)

    fun unregisterServer(session: RelaySocket) {
        val server = sessions.remove(session) ?: return
        serverSessions[server.serverKey]?.let { set ->
            set.remove(session)
            if (set.isEmpty()) serverSessions.remove(server.serverKey, set)
        }
        workspaceSessions[server.workspaceId]?.let { set ->
            set.remove(session)
            if (set.isEmpty()) workspaceSessions.remove(server.workspaceId, set)
        }
        tokens.entries.removeIf { it.value.pluginSession === session }
        removePendingRequests { it.pluginSession === session }
        browserBindings.values
            .filter { it.pluginSession === session }
            .forEach { unbindBrowser(it.browserSession) }
    }

    fun unregisterServer(session: WebSocketSession) = unregisterServer(socket(session))

    fun getServerBySession(session: RelaySocket): GameServer? = sessions[session]
    fun getServerBySession(session: WebSocketSession): GameServer? {
        val socket = ktorSockets[session] ?: return null
        return sessions[socket]
    }

    fun getServerSessions(serverKey: String): Set<RelaySocket> = serverSessions[serverKey]?.toSet() ?: emptySet()

    fun getWorkspaceSessions(workspaceId: String): Set<RelaySocket> =
        workspaceSessions[workspaceId]?.toSet() ?: emptySet()

    fun getServerForResume(workspaceId: String, serverId: String): GameServer? =
        workspaceSessions[workspaceId]
            ?.asSequence()
            ?.mapNotNull { sessions[it] }
            ?.firstOrNull { it.serverId == serverId }

    fun registerToken(token: String, pluginSession: RelaySocket, playerName: String, expiresIn: Long): Boolean {
        val server = sessions[pluginSession] ?: return false
        val tokenHash = RelaySecrets.sha256(token)
        val entry = RegisteredToken(
            tokenHash = tokenHash,
            pluginSession = pluginSession,
            serverId = server.serverId,
            workspaceId = server.workspaceId,
            playerName = playerName,
            expiresAt = System.currentTimeMillis() + expiresIn
        )
        return tokens.putIfAbsent(tokenHash, entry) == null
    }

    /** 原子读取并删除，token 无论成功、过期或目标插件离线都不能再次使用。 */
    fun consumeToken(token: String): RegisteredToken? {
        val tokenHash = RelaySecrets.sha256(token)
        var consumed: RegisteredToken? = null
        tokens.compute(tokenHash) { _, current ->
            consumed = current
            null
        }
        val entry = consumed ?: return null
        if (System.currentTimeMillis() > entry.expiresAt) return null
        val server = sessions[entry.pluginSession] ?: return null
        if (server.workspaceId != entry.workspaceId || server.serverId != entry.serverId) return null
        return entry
    }

    fun revokeToken(token: String, pluginSession: RelaySocket? = null): Boolean {
        val tokenHash = RelaySecrets.sha256(token)
        if (pluginSession == null) return tokens.remove(tokenHash) != null
        var removed = false
        tokens.computeIfPresent(tokenHash) { _, current ->
            if (current.pluginSession === pluginSession) {
                removed = true
                null
            } else {
                current
            }
        }
        return removed
    }

    fun bindBrowser(
        browserSession: RelaySocket,
        browserId: String,
        playerName: String,
        server: GameServer
    ): BrowserBinding {
        unbindBrowser(browserSession)
        browserBindings.values
            .filter { it.workspaceId == server.workspaceId && it.browserId == browserId }
            .forEach { unbindBrowser(it.browserSession) }
        val binding = BrowserBinding(
            browserId = browserId,
            playerName = playerName,
            workspaceId = server.workspaceId,
            serverId = server.serverId,
            pluginSession = server.session,
            browserSession = browserSession
        )
        browserBindings[browserSession] = binding
        workspaceBrowsers.computeIfAbsent(server.workspaceId) { ConcurrentHashMap.newKeySet() }.add(browserSession)
        return binding
    }

    fun unbindBrowser(browserSession: RelaySocket): BrowserBinding? {
        val binding = browserBindings.remove(browserSession) ?: return null
        workspaceBrowsers[binding.workspaceId]?.remove(browserSession)
        removePendingRequests { it.browserSession === browserSession }
        return binding
    }

    fun unbindBrowser(browserSession: WebSocketSession): BrowserBinding? =
        ktorSockets[browserSession]?.let { unbindBrowser(it) }

    fun getBrowserBinding(browserSession: RelaySocket): BrowserBinding? = browserBindings[browserSession]

    fun updatePresence(browserSession: RelaySocket, currentFile: String?): BrowserBinding? {
        var updated: BrowserBinding? = null
        browserBindings.computeIfPresent(browserSession) { _, current ->
            current.copy(currentFile = currentFile, lastActiveAt = System.currentTimeMillis()).also { updated = it }
        }
        return updated
    }

    fun getBrowsersForWorkspace(workspaceId: String): Set<RelaySocket> =
        workspaceBrowsers[workspaceId]?.toSet() ?: emptySet()

    fun getPresence(workspaceId: String): List<BrowserBinding> =
        workspaceBrowsers[workspaceId]
            ?.mapNotNull { browserBindings[it] }
            ?.sortedWith(compareBy(BrowserBinding::playerName, BrowserBinding::browserId))
            ?: emptyList()

    suspend fun reserveRequest(
        browserSession: RelaySocket,
        originalId: String,
        type: String,
        path: String?,
        baseRevision: Long?,
        force: Boolean
    ): RequestReservation {
        cleanupExpiredRequests()
        val initialBinding = browserBindings[browserSession] ?: return RequestReservation.BrowserNotBound
        val relayId = RelaySecrets.newToken(24)
        var lock: Mutex? = null
        if (type == "file.write" && path != null) {
            val key = RevisionKey(initialBinding.workspaceId, path)
            lock = revisionLocks.computeIfAbsent(key) { Mutex() }
            lock.lock(relayId)
            val current = revisions[key] ?: 0L
            if (!force && baseRevision != current) {
                lock.unlock(relayId)
                return RequestReservation.Conflict(current)
            }
        }
        val binding = browserBindings[browserSession]
        if (binding == null || binding != initialBinding || sessions[binding.pluginSession] == null) {
            if (lock?.isLocked == true) lock.unlock(relayId)
            return RequestReservation.BrowserNotBound
        }
        val pending = PendingRequest(
            relayId = relayId,
            originalId = originalId,
            type = type,
            browserSession = browserSession,
            pluginSession = binding.pluginSession,
            workspaceId = binding.workspaceId,
            browserId = binding.browserId,
            path = path,
            writeLock = lock
        )
        pendingRequests[relayId] = pending
        return RequestReservation.Reserved(pending)
    }

    fun takePendingRequest(relayId: String, pluginSession: RelaySocket): PendingRequest? {
        var taken: PendingRequest? = null
        pendingRequests.computeIfPresent(relayId) { _, current ->
            if (current.pluginSession === pluginSession) {
                taken = current
                null
            } else {
                current
            }
        }
        return taken
    }

    fun finishRequest(request: PendingRequest, successfulWrite: Boolean): Long? {
        var revision: Long? = null
        if (request.type == "file.write" && request.path != null) {
            if (successfulWrite) {
                val key = RevisionKey(request.workspaceId, request.path)
                revision = revisions.merge(key, 1L, Long::plus)
            }
            unlockRequest(request)
        }
        return revision
    }

    fun currentRevision(workspaceId: String, path: String): Long = revisions[RevisionKey(workspaceId, path)] ?: 0L

    fun cleanupExpiredTokens(): Int {
        val now = System.currentTimeMillis()
        val expired = tokens.entries.filter { now > it.value.expiresAt }
        expired.forEach { tokens.remove(it.key, it.value) }
        cleanupExpiredRequests(now)
        return expired.size
    }

    fun cleanupExpiredRequests(now: Long = System.currentTimeMillis()): Int {
        val expired = pendingRequests.values.filter { now - it.createdAt >= requestTimeoutMillis }
        expired.forEach { request ->
            if (pendingRequests.remove(request.relayId, request)) unlockRequest(request)
        }
        return expired.size
    }

    private fun removePendingRequests(predicate: (PendingRequest) -> Boolean) {
        pendingRequests.values.filter(predicate).forEach { request ->
            if (pendingRequests.remove(request.relayId, request)) unlockRequest(request)
        }
    }

    private fun unlockRequest(request: PendingRequest) {
        val lock = request.writeLock ?: return
        if (lock.holdsLock(request.relayId)) lock.unlock(request.relayId)
    }

    fun serverCount(): Int = sessions.size
    fun tokenCount(): Int = tokens.size
    fun browserCount(): Int = browserBindings.size
    fun pendingRequestCount(): Int = pendingRequests.size
    fun isServerOnline(serverKey: String): Boolean = !serverSessions[serverKey].isNullOrEmpty()
    fun onlineSessionCount(serverKey: String): Int = serverSessions[serverKey]?.size ?: 0
    fun getOnlineServerKeys(): Set<String> = serverSessions.keys.filter { !serverSessions[it].isNullOrEmpty() }.toSet()
}
