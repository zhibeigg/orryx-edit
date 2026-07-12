package com.orryx.editor.session

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import com.orryx.editor.relay.EditorSessionRecord
import com.orryx.editor.relay.EditorSessionStore
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresRelayEditorSessionStore(
    private val database: R2dbcDatabase
) : EditorSessionStore {
    override suspend fun save(tokenHash: String, session: EditorSessionRecord) {
        requireTokenHash(tokenHash)
        val expiresAt = Instant.ofEpochMilli(session.expiresAt)
        val now = Instant.now()
        require(expiresAt.isAfter(now)) { "resume session 已过期" }
        database.inTransaction { connection ->
            val licenseActive = queryOne(
                connection.createStatement(
                    """
                    SELECT 1 FROM licenses
                    WHERE license_key = $1 AND server_key = $2 AND enabled = TRUE
                      AND (expires_at IS NULL OR expires_at > $3)
                    FOR KEY SHARE
                    """.trimIndent()
                ).bind(0, session.licenseKey).bind(1, session.serverKey).bind(2, now)
            ) { _, _ -> true } ?: false
            require(licenseActive) { "license 无效、已禁用或已过期" }
            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO editor_sessions(
                        id, license_key, workspace_id, server_key, server_id, player_name, browser_id,
                        resume_token_hash, created_at, last_seen_at, expires_at, revoked_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, NULL)
                    """.trimIndent()
                )
                    .bind(0, UUID.randomUUID())
                    .bind(1, session.licenseKey)
                    .bind(2, session.workspaceId)
                    .bind(3, session.serverKey)
                    .bind(4, session.serverId)
                    .bind(5, session.playerName)
                    .bind(6, session.browserId)
                    .bind(7, tokenHash)
                    .bind(8, now)
                    .bind(9, expiresAt)
            )
        }
    }

    override suspend fun consume(tokenHash: String): EditorSessionRecord? {
        requireTokenHash(tokenHash)
        val now = Instant.now()
        return database.inTransaction { connection ->
            queryOne(
                connection.createStatement(
                    """
                    DELETE FROM editor_sessions AS session
                    USING licenses AS license
                    WHERE session.resume_token_hash = $1
                      AND session.license_key = license.license_key
                      AND session.server_key = license.server_key
                      AND session.revoked_at IS NULL
                      AND session.expires_at > $2
                      AND license.enabled = TRUE
                      AND (license.expires_at IS NULL OR license.expires_at > $2)
                    RETURNING session.*
                    """.trimIndent()
                ).bind(0, tokenHash).bind(1, now)
            ) { row, _ -> row.toRelayRecord() }
        }
    }

    override suspend fun revoke(tokenHash: String) {
        requireTokenHash(tokenHash)
        database.inTransaction { connection ->
            executeFully(
                connection.createStatement("DELETE FROM editor_sessions WHERE resume_token_hash = $1")
                    .bind(0, tokenHash)
            )
        }
    }

    private fun Row.toRelayRecord(): EditorSessionRecord = EditorSessionRecord(
        licenseKey = get("license_key", String::class.java)!!,
        browserId = get("browser_id", String::class.java)!!,
        playerName = get("player_name", String::class.java)!!,
        workspaceId = get("workspace_id", String::class.java)!!,
        serverKey = get("server_key", String::class.java)!!,
        serverId = get("server_id", String::class.java)!!,
        expiresAt = get("expires_at", Instant::class.java)!!.toEpochMilli()
    )

    private fun requireTokenHash(tokenHash: String) {
        require(SHA256.matches(tokenHash)) { "resume token hash 格式无效" }
    }

    private companion object {
        val SHA256 = Regex("^[a-f0-9]{64}$")
    }
}
