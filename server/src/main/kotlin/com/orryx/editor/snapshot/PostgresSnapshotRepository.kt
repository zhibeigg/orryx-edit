package com.orryx.editor.snapshot

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresSnapshotRepository(private val database: R2dbcDatabase) : SnapshotRepository {
    override suspend fun create(snapshot: ServerSnapshot): ServerSnapshot = database.inTransaction { connection ->
        require(snapshot.serverInstanceId.isNotBlank()) { "serverInstanceId 不能为空" }
        SnapshotManifest.validateFiles(snapshot.files)
        require(snapshot.manifestRevision == SnapshotManifest.canonicalRevision(snapshot.files)) {
            "manifestRevision 与 canonical hash 不一致"
        }
        val inserted = executeFully(
            connection.createStatement(
                """
                INSERT INTO server_snapshots(id, server_instance_id, manifest_revision, source, created_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (server_instance_id, manifest_revision) DO NOTHING
                """.trimIndent()
            )
                .bind(0, snapshot.id)
                .bind(1, UUID.fromString(snapshot.serverInstanceId))
                .bind(2, snapshot.manifestRevision)
                .bind(3, snapshot.source.name)
                .bind(4, snapshot.createdAt)
        )
        if (inserted > 0) {
            snapshot.files.forEach { file ->
                executeFully(
                    connection.createStatement(
                        """
                        INSERT INTO snapshot_files(snapshot_id, path, revision, size, content)
                        VALUES ($1, $2, $3, $4, $5)
                        """.trimIndent()
                    )
                        .bind(0, snapshot.id)
                        .bind(1, file.path)
                        .bind(2, file.revision)
                        .bind(3, file.size)
                        .bindNullable(4, file.content)
                )
            }
            snapshot.copy(files = snapshot.files.toList())
        } else {
            checkNotNull(findByManifest(connection, snapshot.serverInstanceId, snapshot.manifestRevision)) {
                "snapshot 冲突后无法读取既有记录"
            }
        }
    }

    override suspend fun find(id: UUID): ServerSnapshot? = database.withConnection { connection ->
        find(connection, id)
    }

    override suspend fun findByManifest(serverInstanceId: String, manifestRevision: String): ServerSnapshot? =
        database.withConnection { connection -> findByManifest(connection, serverInstanceId, manifestRevision) }

    override suspend fun list(serverInstanceId: String?, limit: Int): List<ServerSnapshot> {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        return database.withConnection { connection ->
            val statement = if (serverInstanceId == null) {
                connection.createStatement(
                    """
                    SELECT id, server_instance_id, manifest_revision, source, created_at
                    FROM server_snapshots ORDER BY created_at DESC, id LIMIT $1
                    """.trimIndent()
                ).bind(0, limit)
            } else {
                connection.createStatement(
                    """
                    SELECT id, server_instance_id, manifest_revision, source, created_at
                    FROM server_snapshots WHERE server_instance_id = $1
                    ORDER BY created_at DESC, id LIMIT $2
                    """.trimIndent()
                ).bind(0, UUID.fromString(serverInstanceId)).bind(1, limit)
            }
            queryAll(statement) { row, _ -> row.toSnapshot(emptyList()) }
                .map { snapshot -> snapshot.copy(files = files(connection, snapshot.id)) }
        }
    }

    private suspend fun find(connection: Connection, id: UUID): ServerSnapshot? {
        val snapshot = queryOne(
            connection.createStatement(
                "SELECT id, server_instance_id, manifest_revision, source, created_at FROM server_snapshots WHERE id = $1"
            ).bind(0, id)
        ) { row, _ -> row.toSnapshot(emptyList()) } ?: return null
        return snapshot.copy(files = files(connection, snapshot.id))
    }

    private suspend fun findByManifest(
        connection: Connection,
        serverInstanceId: String,
        manifestRevision: String
    ): ServerSnapshot? {
        val snapshot = queryOne(
            connection.createStatement(
                """
                SELECT id, server_instance_id, manifest_revision, source, created_at
                FROM server_snapshots WHERE server_instance_id = $1 AND manifest_revision = $2
                """.trimIndent()
            ).bind(0, UUID.fromString(serverInstanceId)).bind(1, manifestRevision)
        ) { row, _ -> row.toSnapshot(emptyList()) } ?: return null
        return snapshot.copy(files = files(connection, snapshot.id))
    }

    private suspend fun files(connection: Connection, snapshotId: UUID): List<SnapshotFile> = queryAll(
        connection.createStatement(
            """
            SELECT path, revision, size, content FROM snapshot_files
            WHERE snapshot_id = $1 ORDER BY path
            """.trimIndent()
        ).bind(0, snapshotId)
    ) { row, _ -> row.toSnapshotFile() }
}

private fun Row.toSnapshot(files: List<SnapshotFile>): ServerSnapshot = ServerSnapshot(
    id = required("id", UUID::class.java),
    serverInstanceId = required("server_instance_id", UUID::class.java).toString(),
    manifestRevision = required("manifest_revision", String::class.java),
    files = files,
    source = SnapshotSource.valueOf(required("source", String::class.java)),
    createdAt = required("created_at", Instant::class.java)
)

private fun Row.toSnapshotFile(): SnapshotFile = SnapshotFile(
    path = required("path", String::class.java),
    revision = required("revision", String::class.java),
    size = required("size", java.lang.Long::class.java).toLong(),
    content = get("content", String::class.java)
)

private fun <T : Any> Row.required(name: String, type: Class<T>): T =
    requireNotNull(get(name, type)) { "Postgres 必填列为空: $name" }
