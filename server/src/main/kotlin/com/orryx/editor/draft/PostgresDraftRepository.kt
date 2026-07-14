package com.orryx.editor.draft

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import com.orryx.editor.versioning.AppendDraftVersionRecord
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import com.orryx.editor.versioning.DraftFileValidation
import com.orryx.editor.versioning.DraftVersion
import com.orryx.editor.versioning.DraftVersionSource
import com.orryx.editor.versioning.StoredDraftVersion
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import io.r2dbc.spi.Statement
import java.time.Instant
import java.util.UUID

class PostgresDraftRepository(private val database: R2dbcDatabase) : DraftRepository {
    override suspend fun create(draft: Draft): Draft = database.inTransaction { connection ->
        val inserted = executeFully(
            connection.createStatement(
                """
                INSERT INTO drafts(
                    id, account_id, server_instance_id, base_snapshot_id, title, status,
                    current_version, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO NOTHING
                """.trimIndent()
            )
                .bind(0, draft.id)
                .bind(1, UUID.fromString(draft.accountId))
                .bind(2, UUID.fromString(draft.serverInstanceId))
                .bind(3, draft.baseSnapshotId)
                .bind(4, draft.title)
                .bind(5, draft.status.name)
                .bind(6, draft.currentVersion)
                .bind(7, draft.createdAt)
                .bind(8, draft.updatedAt)
        )
        if (inserted > 0) draft else {
            val existing = checkNotNull(find(connection, draft.id)) { "draft 冲突后无法读取既有记录" }
            check(existing == draft) { "draft id 已存在且内容不同: ${draft.id}" }
            existing
        }
    }

    override suspend fun find(id: UUID): Draft? = database.withConnection { connection -> find(connection, id) }

    override suspend fun list(accountId: String?, serverInstanceId: String?, limit: Int): List<Draft> {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        return database.withConnection { connection ->
            val conditions = mutableListOf<String>()
            if (accountId != null) conditions += "account_id = $1"
            if (serverInstanceId != null) conditions += "server_instance_id = $${conditions.size + 1}"
            val limitIndex = conditions.size + 1
            val sql = buildString {
                append("SELECT * FROM drafts")
                if (conditions.isNotEmpty()) append(" WHERE ").append(conditions.joinToString(" AND "))
                append(" ORDER BY updated_at DESC, id LIMIT $").append(limitIndex)
            }
            var statement = connection.createStatement(sql)
            var index = 0
            if (accountId != null) statement = statement.bind(index++, UUID.fromString(accountId))
            if (serverInstanceId != null) statement = statement.bind(index++, UUID.fromString(serverInstanceId))
            statement = statement.bind(index, limit)
            queryAll(statement) { row, _ -> row.toDraft() }
        }
    }

    override suspend fun appendVersion(record: AppendDraftVersionRecord): AppendVersionResult =
        database.inTransaction { connection ->
            DraftFileValidation.validate(record.files)
            require(record.expectedCurrentVersion >= 0) { "expectedCurrentVersion 不能为负数" }
            require(record.authorAccountId.isNotBlank()) { "authorAccountId 不能为空" }
            require(com.orryx.editor.snapshot.SnapshotManifest.isSha256(record.manifestRevision)) {
                "manifestRevision 必须是 64 位小写 SHA-256"
            }
            findVersion(connection, record.id)?.let { existing ->
                check(existing.matches(record)) { "draft version id 已存在且内容不同: ${record.id}" }
                return@inTransaction AppendVersionResult.Created(existing)
            }

            val draft = queryOne(
                connection.createStatement("SELECT * FROM drafts WHERE id = $1 FOR UPDATE").bind(0, record.draftId)
            ) { row, _ -> row.toDraft() } ?: return@inTransaction AppendVersionResult.DraftNotFound
            if (draft.status == DraftStatus.ARCHIVED) return@inTransaction AppendVersionResult.DraftArchived
            if (draft.currentVersion != record.expectedCurrentVersion) {
                return@inTransaction AppendVersionResult.Conflict(record.expectedCurrentVersion, draft.currentVersion)
            }

            val nextNumber = draft.currentVersion + 1
            val parentId = if (draft.currentVersion == 0L) null else queryOne(
                connection.createStatement(
                    "SELECT id FROM draft_versions WHERE draft_id = $1 AND version_number = $2"
                ).bind(0, draft.id).bind(1, draft.currentVersion)
            ) { row, _ -> row.required("id", UUID::class.java) }
                ?: error("draft 版本链不完整: ${draft.currentVersion}")

            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO draft_versions(
                        id, draft_id, version_number, parent_version_id, source,
                        manifest_revision, author_account_id, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """.trimIndent()
                )
                    .bind(0, record.id)
                    .bind(1, record.draftId)
                    .bind(2, nextNumber)
                    .bindNullableUuid(3, parentId)
                    .bind(4, record.source.name)
                    .bind(5, record.manifestRevision)
                    .bind(6, UUID.fromString(record.authorAccountId))
                    .bind(7, record.createdAt)
            )
            record.files.forEach { file -> insertFile(connection, record.id, file) }
            val updated = executeFully(
                connection.createStatement(
                    """
                    UPDATE drafts SET current_version = $2, updated_at = $3
                    WHERE id = $1 AND current_version = $4
                    """.trimIndent()
                )
                    .bind(0, draft.id)
                    .bind(1, nextNumber)
                    .bind(2, record.createdAt)
                    .bind(3, record.expectedCurrentVersion)
            )
            check(updated == 1L) { "draft CAS 更新失败" }
            AppendVersionResult.Created(
                StoredDraftVersion(
                    DraftVersion(
                        id = record.id,
                        draftId = record.draftId,
                        versionNumber = nextNumber,
                        parentVersionId = parentId,
                        source = record.source,
                        manifestRevision = record.manifestRevision,
                        authorAccountId = record.authorAccountId,
                        createdAt = record.createdAt
                    ),
                    record.files.toList()
                )
            )
        }

    override suspend fun findVersion(id: UUID): StoredDraftVersion? = database.withConnection { connection ->
        findVersion(connection, id)
    }

    override suspend fun findVersion(draftId: UUID, versionNumber: Long): StoredDraftVersion? =
        database.withConnection { connection ->
            val version = queryOne(
                connection.createStatement(
                    "SELECT * FROM draft_versions WHERE draft_id = $1 AND version_number = $2"
                ).bind(0, draftId).bind(1, versionNumber)
            ) { row, _ -> row.toDraftVersion() } ?: return@withConnection null
            StoredDraftVersion(version, files(connection, version.id))
        }

    override suspend fun listVersions(draftId: UUID, limit: Int): List<StoredDraftVersion> {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        return database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM draft_versions WHERE draft_id = $1
                    ORDER BY version_number DESC LIMIT $2
                    """.trimIndent()
                ).bind(0, draftId).bind(1, limit)
            ) { row, _ -> row.toDraftVersion() }
                .map { version -> StoredDraftVersion(version, files(connection, version.id)) }
        }
    }

    private suspend fun find(connection: Connection, id: UUID): Draft? = queryOne(
        connection.createStatement("SELECT * FROM drafts WHERE id = $1").bind(0, id)
    ) { row, _ -> row.toDraft() }

    private suspend fun findVersion(connection: Connection, id: UUID): StoredDraftVersion? {
        val version = queryOne(
            connection.createStatement("SELECT * FROM draft_versions WHERE id = $1").bind(0, id)
        ) { row, _ -> row.toDraftVersion() } ?: return null
        return StoredDraftVersion(version, files(connection, version.id))
    }

    private suspend fun files(connection: Connection, versionId: UUID): List<DraftFile> = queryAll(
        connection.createStatement(
            """
            SELECT change_type, path, base_revision, content_revision, size, content
            FROM draft_files WHERE version_id = $1 ORDER BY path
            """.trimIndent()
        ).bind(0, versionId)
    ) { row, _ -> row.toDraftFile() }

    private suspend fun insertFile(connection: Connection, versionId: UUID, file: DraftFile) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO draft_files(
                    version_id, change_type, path, base_revision, content_revision, size, content
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """.trimIndent()
            )
                .bind(0, versionId)
                .bind(1, file.changeType.name)
                .bind(2, file.path)
                .bindNullable(3, file.baseRevision)
                .bindNullable(4, file.contentRevision)
                .bindNullableLong(5, file.size.takeIf { file.changeType == DraftFileChangeType.UPSERT })
                .bindNullable(6, file.content)
        )
    }
}

private fun Row.toDraft(): Draft = Draft(
    id = required("id", UUID::class.java),
    accountId = required("account_id", UUID::class.java).toString(),
    serverInstanceId = required("server_instance_id", UUID::class.java).toString(),
    baseSnapshotId = required("base_snapshot_id", UUID::class.java),
    title = required("title", String::class.java),
    status = DraftStatus.valueOf(required("status", String::class.java)),
    currentVersion = required("current_version", java.lang.Long::class.java).toLong(),
    createdAt = required("created_at", Instant::class.java),
    updatedAt = required("updated_at", Instant::class.java)
)

private fun Row.toDraftVersion(): DraftVersion = DraftVersion(
    id = required("id", UUID::class.java),
    draftId = required("draft_id", UUID::class.java),
    versionNumber = required("version_number", java.lang.Long::class.java).toLong(),
    parentVersionId = get("parent_version_id", UUID::class.java),
    source = DraftVersionSource.valueOf(required("source", String::class.java)),
    manifestRevision = required("manifest_revision", String::class.java),
    authorAccountId = required("author_account_id", UUID::class.java).toString(),
    createdAt = required("created_at", Instant::class.java)
)

private fun Row.toDraftFile(): DraftFile = DraftFile(
    changeType = DraftFileChangeType.valueOf(required("change_type", String::class.java)),
    path = required("path", String::class.java),
    baseRevision = get("base_revision", String::class.java),
    contentRevision = get("content_revision", String::class.java),
    size = get("size", java.lang.Long::class.java)?.toLong() ?: 0L,
    content = get("content", String::class.java)
)

private fun <T : Any> Row.required(name: String, type: Class<T>): T =
    requireNotNull(get(name, type)) { "Postgres 必填列为空: $name" }

private fun Statement.bindNullableUuid(index: Int, value: UUID?): Statement =
    if (value == null) bindNull(index, UUID::class.java) else bind(index, value)

private fun Statement.bindNullableLong(index: Int, value: Long?): Statement =
    if (value == null) bindNull(index, java.lang.Long::class.java) else bind(index, value)

private fun StoredDraftVersion.matches(record: AppendDraftVersionRecord): Boolean =
    version.id == record.id &&
        version.draftId == record.draftId &&
        version.versionNumber == record.expectedCurrentVersion + 1 &&
        version.source == record.source &&
        version.manifestRevision == record.manifestRevision &&
        version.authorAccountId == record.authorAccountId &&
        version.createdAt == record.createdAt &&
        files == record.files
