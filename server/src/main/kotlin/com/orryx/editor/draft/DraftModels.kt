package com.orryx.editor.draft

import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftVersionSource
import java.time.Instant
import java.util.UUID

data class Draft(
    val id: UUID,
    val accountId: String,
    val serverInstanceId: String,
    val baseSnapshotId: UUID,
    val title: String,
    val status: DraftStatus,
    val currentVersion: Long,
    val createdAt: Instant,
    val updatedAt: Instant
)

enum class DraftStatus {
    OPEN,
    ARCHIVED
}

data class CreateDraftCommand(
    val accountId: String,
    val serverInstanceId: String,
    val baseSnapshotId: UUID,
    val title: String,
    val id: UUID = UUID.randomUUID(),
    val createdAt: Instant? = null
)

data class AppendDraftVersionCommand(
    val draftId: UUID,
    val expectedCurrentVersion: Long,
    val files: List<DraftFile>,
    val source: DraftVersionSource,
    val authorAccountId: String,
    val id: UUID = UUID.randomUUID(),
    val createdAt: Instant? = null
)

data class AiDraftArtifact(
    val path: String,
    val content: String,
    val baseRevision: String? = null
)
