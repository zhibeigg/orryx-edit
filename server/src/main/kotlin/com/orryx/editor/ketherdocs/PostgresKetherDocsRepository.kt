package com.orryx.editor.ketherdocs

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant

internal class PostgresKetherDocsRepository(private val database: R2dbcDatabase) : KetherDocsRepository {
    override suspend fun load(channel: String): CachedKetherDocs? = database.withConnection { connection ->
        queryOne(
            connection.createStatement("SELECT * FROM kether_docs_cache WHERE channel = $1").bind(0, channel)
        ) { row, _ -> row.toCache() }
    }

    override suspend fun saveSuccess(cache: CachedKetherDocs, state: StoredKetherDocsSyncState) {
        database.inTransaction { connection ->
            saveCache(connection, cache)
            saveState(connection, state)
        }
    }

    override suspend fun loadState(channel: String): StoredKetherDocsSyncState? = database.withConnection { connection ->
        queryOne(
            connection.createStatement("SELECT * FROM kether_docs_sync_state WHERE channel = $1").bind(0, channel)
        ) { row, _ -> row.toSyncState() }
    }

    override suspend fun saveState(state: StoredKetherDocsSyncState) {
        database.withConnection { connection -> saveState(connection, state) }
    }

    private suspend fun saveCache(connection: Connection, cache: CachedKetherDocs) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO kether_docs_cache(
                    channel, release_id, plugin_version, commit_sha, schema_version,
                    schema_sha256, schema_bytes, schema_json, published_at, synced_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT(channel) DO UPDATE SET
                    release_id = EXCLUDED.release_id,
                    plugin_version = EXCLUDED.plugin_version,
                    commit_sha = EXCLUDED.commit_sha,
                    schema_version = EXCLUDED.schema_version,
                    schema_sha256 = EXCLUDED.schema_sha256,
                    schema_bytes = EXCLUDED.schema_bytes,
                    schema_json = EXCLUDED.schema_json,
                    published_at = EXCLUDED.published_at,
                    synced_at = EXCLUDED.synced_at
                """.trimIndent()
            )
                .bind(0, cache.channel)
                .bind(1, cache.releaseId)
                .bind(2, cache.pluginVersion)
                .bind(3, cache.commit)
                .bind(4, cache.schemaVersion)
                .bind(5, cache.schemaSha256)
                .bind(6, cache.schemaBytes)
                .bind(7, cache.schemaJson)
                .bind(8, cache.publishedAt)
                .bind(9, cache.syncedAt)
        )
    }

    private suspend fun saveState(connection: Connection, state: StoredKetherDocsSyncState) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO kether_docs_sync_state(
                    channel, last_attempt_at, last_success_at, next_attempt_at, error_code
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT(channel) DO UPDATE SET
                    last_attempt_at = EXCLUDED.last_attempt_at,
                    last_success_at = EXCLUDED.last_success_at,
                    next_attempt_at = EXCLUDED.next_attempt_at,
                    error_code = EXCLUDED.error_code
                """.trimIndent()
            )
                .bind(0, state.channel)
                .bindNullable(1, state.lastAttemptAt)
                .bindNullable(2, state.lastSuccessAt)
                .bindNullable(3, state.nextAttemptAt)
                .bindNullable(4, state.errorCode)
        )
    }

    private fun Row.toCache(): CachedKetherDocs = CachedKetherDocs(
        channel = requiredString("channel"),
        releaseId = requiredString("release_id"),
        pluginVersion = requiredString("plugin_version"),
        commit = requiredString("commit_sha"),
        schemaVersion = get("schema_version", Integer::class.java)?.toInt()
            ?: error("kether_docs_cache.schema_version 不能为空"),
        schemaSha256 = requiredString("schema_sha256"),
        schemaBytes = get("schema_bytes", java.lang.Long::class.java)?.toLong()
            ?: error("kether_docs_cache.schema_bytes 不能为空"),
        schemaJson = requiredString("schema_json"),
        publishedAt = requiredInstant("published_at"),
        syncedAt = requiredInstant("synced_at")
    )

    private fun Row.toSyncState(): StoredKetherDocsSyncState = StoredKetherDocsSyncState(
        channel = requiredString("channel"),
        lastAttemptAt = get("last_attempt_at", Instant::class.java),
        lastSuccessAt = get("last_success_at", Instant::class.java),
        nextAttemptAt = get("next_attempt_at", Instant::class.java),
        errorCode = get("error_code", String::class.java)
    )

    private fun Row.requiredString(name: String): String = get(name, String::class.java)
        ?: error("$name 不能为空")

    private fun Row.requiredInstant(name: String): Instant = get(name, Instant::class.java)
        ?: error("$name 不能为空")
}
