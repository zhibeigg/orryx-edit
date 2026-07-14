package com.orryx.editor.session

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresEditorSessionRepository(
    private val database: R2dbcDatabase
) : EditorSessionRepository {
    override suspend fun create(command: CreateEditorSessionCommand): EditorSession {
        require(!command.ttl.isNegative && !command.ttl.isZero) { "session ttl 必须大于 0" }
        requirePostgresMetadata(command)
        val session = EditorSession(
            id = UUID.randomUUID(),
            licenseKey = command.licenseKey,
            workspaceId = command.workspaceId,
            serverKey = command.serverKey,
            serverId = command.serverId,
            playerName = command.playerName,
            browserId = command.browserId,
            resumeTokenHash = ResumeTokenHash.sha256(command.resumeToken),
            createdAt = command.now,
            lastSeenAt = command.now,
            expiresAt = command.now.plus(command.ttl),
            revokedAt = null
        )
        database.inTransaction { connection ->
            val effective = queryOne(
                connection.createStatement(
                    """
                    SELECT 1 FROM licenses
                    WHERE license_key = $1 AND server_key = $2 AND enabled = TRUE
                    FOR KEY SHARE
                    """.trimIndent()
                ).bind(0, command.licenseKey).bind(1, command.serverKey)
            ) { _, _ -> true } ?: false
            require(effective) { "license 无效或 serverKey 不匹配" }
            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO editor_sessions(
                        id, license_key, workspace_id, server_key, server_id, player_name, browser_id,
                        resume_token_hash, created_at, last_seen_at, expires_at, revoked_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)
                    """.trimIndent()
                )
                    .bind(0, session.id)
                    .bind(1, session.licenseKey)
                    .bind(2, session.workspaceId)
                    .bind(3, session.serverKey)
                    .bind(4, session.serverId)
                    .bind(5, session.playerName)
                    .bind(6, session.browserId)
                    .bind(7, session.resumeTokenHash)
                    .bind(8, session.createdAt)
                    .bind(9, session.lastSeenAt)
                    .bind(10, session.expiresAt)
            )
        }
        return session
    }

    override suspend fun findByResumeToken(resumeToken: String, now: Instant): EditorSession? {
        val hash = ResumeTokenHash.sha256(resumeToken)
        return database.withConnection { connection ->
            queryOne(
                connection.createStatement(
                    """
                    SELECT session.* FROM editor_sessions AS session
                    JOIN licenses AS license ON license.license_key = session.license_key
                    WHERE session.resume_token_hash = $1
                      AND session.revoked_at IS NULL AND session.expires_at > $2
                      AND license.server_key = session.server_key
                      AND license.enabled = TRUE
                    """.trimIndent()
                ).bind(0, hash).bind(1, now)
            ) { row, _ -> row.toEditorSession() }
        }
    }

    override suspend fun touch(id: UUID, now: Instant, expiresAt: Instant): Boolean {
        require(expiresAt.isAfter(now)) { "expiresAt 必须晚于 now" }
        return database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    """
                    UPDATE editor_sessions AS session SET last_seen_at = $2, expires_at = $3
                    WHERE session.id = $1 AND session.revoked_at IS NULL AND session.expires_at > $2
                      AND EXISTS (
                          SELECT 1 FROM licenses
                          WHERE license_key = session.license_key
                            AND server_key = session.server_key
                            AND enabled = TRUE
                      )
                    """.trimIndent()
                ).bind(0, id).bind(1, now).bind(2, expiresAt)
            ) > 0
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
        return database.inTransaction { connection ->
            val session = queryOne(
                connection.createStatement(
                    """
                    SELECT session.* FROM editor_sessions AS session
                    JOIN licenses AS license ON license.license_key = session.license_key
                    WHERE session.resume_token_hash = $1
                      AND session.revoked_at IS NULL AND session.expires_at > $2
                      AND license.server_key = session.server_key
                      AND license.enabled = TRUE
                    FOR UPDATE OF session
                    """.trimIndent()
                ).bind(0, oldHash).bind(1, now)
            ) { row, _ -> row.toEditorSession() } ?: return@inTransaction null
            queryOne(
                connection.createStatement(
                    """
                    UPDATE editor_sessions
                    SET resume_token_hash = $2, last_seen_at = $3, expires_at = $4
                    WHERE id = $1 AND resume_token_hash = $5
                    RETURNING *
                    """.trimIndent()
                )
                    .bind(0, session.id)
                    .bind(1, newHash)
                    .bind(2, now)
                    .bind(3, expiresAt)
                    .bind(4, oldHash)
            ) { row, _ -> row.toEditorSession() }
        }
    }

    override suspend fun revoke(id: UUID, now: Instant): Boolean = database.inTransaction { connection ->
        executeFully(
            connection.createStatement(
                "UPDATE editor_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1"
            ).bind(0, id).bind(1, now)
        ) > 0
    }

    override suspend fun cleanup(now: Instant): Long = database.inTransaction { connection ->
        executeFully(
            connection.createStatement(
                "DELETE FROM editor_sessions WHERE revoked_at IS NOT NULL OR expires_at <= $1"
            ).bind(0, now)
        )
    }
}

private fun Row.toEditorSession(): EditorSession = EditorSession(
    id = get("id", UUID::class.java)!!,
    licenseKey = get("license_key", String::class.java)!!,
    workspaceId = get("workspace_id", String::class.java)!!,
    serverKey = get("server_key", String::class.java)!!,
    serverId = get("server_id", String::class.java)!!,
    playerName = get("player_name", String::class.java)!!,
    browserId = get("browser_id", String::class.java)!!,
    resumeTokenHash = get("resume_token_hash", String::class.java)!!,
    createdAt = get("created_at", Instant::class.java)!!,
    lastSeenAt = get("last_seen_at", Instant::class.java)!!,
    expiresAt = get("expires_at", Instant::class.java)!!,
    revokedAt = get("revoked_at", Instant::class.java)
)

private fun requirePostgresMetadata(command: CreateEditorSessionCommand) {
    require(command.workspaceId.isNotBlank()) { "workspaceId 不能为空" }
    require(command.serverKey.isNotBlank()) { "serverKey 不能为空" }
    require(command.serverId.isNotBlank()) { "serverId 不能为空" }
    require(command.playerName.isNotBlank()) { "playerName 不能为空" }
    require(command.browserId.isNotBlank()) { "browserId 不能为空" }
}
