package com.orryx.editor.versioning

import java.time.Instant
import java.util.UUID

data class DraftVersion(
    val id: UUID,
    val draftId: UUID,
    val versionNumber: Long,
    val parentVersionId: UUID?,
    val source: DraftVersionSource,
    val manifestRevision: String,
    val authorAccountId: String,
    val createdAt: Instant
)

enum class DraftVersionSource {
    MANUAL,
    AI,
    IMPORT
}

data class DraftFile(
    val changeType: DraftFileChangeType,
    val path: String,
    val baseRevision: String?,
    val contentRevision: String?,
    val size: Long,
    val content: String?
)

enum class DraftFileChangeType {
    UPSERT,
    DELETE
}

data class StoredDraftVersion(
    val version: DraftVersion,
    val files: List<DraftFile>
)

data class AppendDraftVersionRecord(
    val id: UUID,
    val draftId: UUID,
    val expectedCurrentVersion: Long,
    val source: DraftVersionSource,
    val manifestRevision: String,
    val authorAccountId: String,
    val files: List<DraftFile>,
    val createdAt: Instant
)

sealed interface AppendVersionResult {
    data class Created(val stored: StoredDraftVersion) : AppendVersionResult
    data class Conflict(val expectedCurrentVersion: Long, val actualCurrentVersion: Long) : AppendVersionResult
    data object DraftNotFound : AppendVersionResult
    data object DraftArchived : AppendVersionResult
}
