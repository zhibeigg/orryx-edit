package com.orryx.editor.session

import com.orryx.editor.license.LicenseService
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

class InMemoryEditorSessionRepository(
    private val licenseService: LicenseService
) : EditorSessionRepository {
    private val mutex = Mutex()
    private val sessions = linkedMapOf<UUID, EditorSession>()

    override suspend fun create(command: CreateEditorSessionCommand): EditorSession {
        require(!command.ttl.isNegative && !command.ttl.isZero) { "session ttl 必须大于 0" }
        requireInMemoryMetadata(command)
        val license = licenseService.validate(command.licenseKey)
        require(license != null && license.serverKey == command.serverKey) { "license 无效或 serverKey 不匹配" }
        val hash = ResumeTokenHash.sha256(command.resumeToken)
        return mutex.withLock {
            check(sessions.values.none { it.resumeTokenHash == hash }) { "resume token 已存在" }
            EditorSession(
                id = UUID.randomUUID(),
                licenseKey = command.licenseKey,
                workspaceId = command.workspaceId,
                serverKey = command.serverKey,
                serverId = command.serverId,
                playerName = command.playerName,
                browserId = command.browserId,
                resumeTokenHash = hash,
                createdAt = command.now,
                lastSeenAt = command.now,
                expiresAt = command.now.plus(command.ttl),
                revokedAt = null
            ).also { sessions[it.id] = it }
        }
    }

    override suspend fun findByResumeToken(resumeToken: String, now: Instant): EditorSession? {
        val hash = ResumeTokenHash.sha256(resumeToken)
        val session = mutex.withLock {
            sessions.values.firstOrNull {
                it.resumeTokenHash == hash && it.revokedAt == null && it.expiresAt.isAfter(now)
            }
        } ?: return null
        return session.takeIf { licenseService.validate(it.licenseKey)?.serverKey == it.serverKey }
    }

    override suspend fun touch(id: UUID, now: Instant, expiresAt: Instant): Boolean {
        require(expiresAt.isAfter(now)) { "expiresAt 必须晚于 now" }
        val current = mutex.withLock { sessions[id] } ?: return false
        if (licenseService.validate(current.licenseKey)?.serverKey != current.serverKey) return false
        return mutex.withLock {
            val latest = sessions[id] ?: return@withLock false
            if (latest.revokedAt != null || !latest.expiresAt.isAfter(now)) return@withLock false
            sessions[id] = latest.copy(lastSeenAt = now, expiresAt = expiresAt)
            true
        }
    }

    override suspend fun rotate(
        resumeToken: String,
        replacementToken: String,
        now: Instant,
        expiresAt: Instant
    ): EditorSession? {
        require(expiresAt.isAfter(now)) { "expiresAt 必须晚于 now" }
        val oldHash = ResumeTokenHash.sha256(resumeToken)
        val newHash = ResumeTokenHash.sha256(replacementToken)
        require(oldHash != newHash) { "replacement token 必须不同" }
        val current = mutex.withLock {
            sessions.values.firstOrNull {
                it.resumeTokenHash == oldHash && it.revokedAt == null && it.expiresAt.isAfter(now)
            }
        } ?: return null
        if (licenseService.validate(current.licenseKey)?.serverKey != current.serverKey) return null
        return mutex.withLock {
            val latest = sessions[current.id] ?: return@withLock null
            if (latest.resumeTokenHash != oldHash || latest.revokedAt != null || !latest.expiresAt.isAfter(now)) return@withLock null
            check(sessions.values.none { it.id != latest.id && it.resumeTokenHash == newHash }) { "replacement token 已存在" }
            latest.copy(resumeTokenHash = newHash, lastSeenAt = now, expiresAt = expiresAt)
                .also { sessions[it.id] = it }
        }
    }

    override suspend fun revoke(id: UUID, now: Instant): Boolean = mutex.withLock {
        val current = sessions[id] ?: return@withLock false
        if (current.revokedAt != null) return@withLock true
        sessions[id] = current.copy(revokedAt = now)
        true
    }

    override suspend fun cleanup(now: Instant): Long = mutex.withLock {
        val ids = sessions.values.filter { it.revokedAt != null || !it.expiresAt.isAfter(now) }.map { it.id }
        ids.forEach(sessions::remove)
        ids.size.toLong()
    }
}

private fun requireInMemoryMetadata(command: CreateEditorSessionCommand) {
    require(command.workspaceId.isNotBlank()) { "workspaceId 不能为空" }
    require(command.serverKey.isNotBlank()) { "serverKey 不能为空" }
    require(command.serverId.isNotBlank()) { "serverId 不能为空" }
    require(command.playerName.isNotBlank()) { "playerName 不能为空" }
    require(command.browserId.isNotBlank()) { "browserId 不能为空" }
}
