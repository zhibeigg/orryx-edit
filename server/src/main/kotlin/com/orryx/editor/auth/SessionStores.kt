package com.orryx.editor.auth

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Row
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

class InMemorySessionStore : SessionStore {
    private val mutex = Mutex()
    private val sessions = linkedMapOf<String, SessionRecord>()

    override suspend fun create(record: SessionRecord): Boolean = mutex.withLock {
        if (record.tokenHash in sessions || sessions.values.any { it.view.id == record.view.id }) return@withLock false
        sessions[record.tokenHash] = record
        true
    }

    override suspend fun validateAndTouch(
        tokenHash: String,
        csrfTokenHash: String?,
        now: Instant
    ): SessionRecord? = mutex.withLock {
        val record = sessions[tokenHash] ?: return@withLock null
        if (record.view.revokedAt != null || !record.view.expiresAt.isAfter(now)) return@withLock null
        if (csrfTokenHash != null && record.csrfTokenHash != csrfTokenHash) return@withLock null
        val touched = record.copy(view = record.view.copy(lastSeenAt = now))
        sessions[tokenHash] = touched
        touched
    }

    override suspend fun rotate(tokenHash: String, replacement: SessionRecord, now: Instant): Boolean = mutex.withLock {
        val current = sessions[tokenHash] ?: return@withLock false
        if (current.view.revokedAt != null || !current.view.expiresAt.isAfter(now)) return@withLock false
        if (replacement.tokenHash in sessions || sessions.values.any { it.view.id == replacement.view.id }) return@withLock false
        sessions[tokenHash] = current.copy(view = current.view.copy(revokedAt = now))
        sessions[replacement.tokenHash] = replacement
        true
    }

    override suspend fun revoke(tokenHash: String, now: Instant): Boolean = mutex.withLock {
        val current = sessions[tokenHash] ?: return@withLock false
        if (current.view.revokedAt != null) return@withLock false
        sessions[tokenHash] = current.copy(view = current.view.copy(revokedAt = now))
        true
    }

    override suspend fun revokeAll(accountId: String, now: Instant): Int = mutex.withLock {
        var count = 0
        sessions.replaceAll { _, record ->
            if (record.view.accountId == accountId && record.view.revokedAt == null) {
                count += 1
                record.copy(view = record.view.copy(revokedAt = now))
            } else {
                record
            }
        }
        count
    }

    override suspend fun cleanup(now: Instant): Int = mutex.withLock {
        val before = sessions.size
        sessions.entries.removeIf { (_, record) ->
            !record.view.expiresAt.isAfter(now) || record.view.revokedAt != null
        }
        before - sessions.size
    }
}

class PostgresSessionStore(private val database: R2dbcDatabase) : SessionStore {
    override suspend fun create(record: SessionRecord): Boolean = database.withConnection { connection ->
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_account_sessions(
                    session_id, account_id, token_hash, csrf_token_hash, created_at, last_seen_at,
                    expires_at, rotated_from_id, revoked_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
                """.trimIndent()
            )
                .bind(0, UUID.fromString(record.view.id))
                .bind(1, UUID.fromString(record.view.accountId))
                .bind(2, record.tokenHash)
                .bind(3, record.csrfTokenHash)
                .bind(4, record.view.createdAt)
                .bind(5, record.view.lastSeenAt)
                .bind(6, record.view.expiresAt)
                .let { statement ->
                    record.view.rotatedFromId?.let { statement.bind(7, UUID.fromString(it)) }
                        ?: statement.bindNull(7, UUID::class.java)
                }
                .bindNull(8, Instant::class.java)
        ) == 1L
    }

    override suspend fun validateAndTouch(
        tokenHash: String,
        csrfTokenHash: String?,
        now: Instant
    ): SessionRecord? = database.inTransaction { connection ->
        val statement = connection.createStatement(
            """
            UPDATE commercial_account_sessions
            SET last_seen_at = $2
            WHERE token_hash = $1
              AND revoked_at IS NULL
              AND expires_at > $2
              AND ($3::text IS NULL OR csrf_token_hash = $3)
            RETURNING *
            """.trimIndent()
        ).bind(0, tokenHash).bind(1, now).let { prepared ->
            csrfTokenHash?.let { prepared.bind(2, it) } ?: prepared.bindNull(2, String::class.java)
        }
        queryOne(statement) { row, _ -> row.toSessionRecord() }
    }

    override suspend fun rotate(tokenHash: String, replacement: SessionRecord, now: Instant): Boolean =
        database.inTransaction { connection ->
            val current = queryOne(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_account_sessions
                    WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
                    FOR UPDATE
                    """.trimIndent()
                ).bind(0, tokenHash).bind(1, now)
            ) { row, _ -> row.toSessionRecord() } ?: return@inTransaction false
            if (current.view.accountId != replacement.view.accountId) return@inTransaction false
            val inserted = executeFully(
                connection.createStatement(
                    """
                    INSERT INTO commercial_account_sessions(
                        session_id, account_id, token_hash, csrf_token_hash, created_at, last_seen_at,
                        expires_at, rotated_from_id, revoked_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
                    ON CONFLICT DO NOTHING
                    """.trimIndent()
                )
                    .bind(0, UUID.fromString(replacement.view.id))
                    .bind(1, UUID.fromString(replacement.view.accountId))
                    .bind(2, replacement.tokenHash)
                    .bind(3, replacement.csrfTokenHash)
                    .bind(4, replacement.view.createdAt)
                    .bind(5, replacement.view.lastSeenAt)
                    .bind(6, replacement.view.expiresAt)
                    .bind(7, UUID.fromString(current.view.id))
            )
            if (inserted != 1L) return@inTransaction false
            executeFully(
                connection.createStatement(
                    "UPDATE commercial_account_sessions SET revoked_at = $2 WHERE token_hash = $1"
                ).bind(0, tokenHash).bind(1, now)
            ) == 1L
        }

    override suspend fun revoke(tokenHash: String, now: Instant): Boolean = database.withConnection { connection ->
        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_account_sessions SET revoked_at = $2
                WHERE token_hash = $1 AND revoked_at IS NULL
                """.trimIndent()
            ).bind(0, tokenHash).bind(1, now)
        ) == 1L
    }

    override suspend fun revokeAll(accountId: String, now: Instant): Int = database.withConnection { connection ->
        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_account_sessions SET revoked_at = $2
                WHERE account_id = $1 AND revoked_at IS NULL
                """.trimIndent()
            ).bind(0, UUID.fromString(accountId)).bind(1, now)
        ).toInt()
    }

    override suspend fun cleanup(now: Instant): Int = database.withConnection { connection ->
        executeFully(
            connection.createStatement(
                """
                DELETE FROM commercial_account_sessions
                WHERE expires_at <= $1 OR revoked_at IS NOT NULL
                """.trimIndent()
            ).bind(0, now)
        ).toInt()
    }
}

private fun Row.toSessionRecord(): SessionRecord = SessionRecord(
    view = SessionView(
        id = get("session_id", UUID::class.java)!!.toString(),
        accountId = get("account_id", UUID::class.java)!!.toString(),
        createdAt = get("created_at", Instant::class.java)!!,
        lastSeenAt = get("last_seen_at", Instant::class.java)!!,
        expiresAt = get("expires_at", Instant::class.java)!!,
        rotatedFromId = get("rotated_from_id", UUID::class.java)?.toString(),
        revokedAt = get("revoked_at", Instant::class.java)
    ),
    tokenHash = get("token_hash", String::class.java)!!,
    csrfTokenHash = get("csrf_token_hash", String::class.java)!!
)
