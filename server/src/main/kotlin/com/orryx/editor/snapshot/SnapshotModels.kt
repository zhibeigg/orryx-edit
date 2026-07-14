package com.orryx.editor.snapshot

import java.time.Instant
import java.util.UUID

data class ServerSnapshot(
    val id: UUID,
    val serverInstanceId: String,
    val manifestRevision: String,
    val files: List<SnapshotFile>,
    val source: SnapshotSource,
    val createdAt: Instant
)

data class SnapshotFile(
    val path: String,
    val revision: String,
    val size: Long,
    val content: String?
)

enum class SnapshotSource {
    PLUGIN,
    BROWSER,
    IMPORT,
    RELEASE
}

data class SnapshotLimits(
    val maxFiles: Int = 10_000,
    val maxFileBytes: Long = 2L * 1024 * 1024,
    val maxTotalBytes: Long = 64L * 1024 * 1024,
    val maxPathBytes: Int = 4 * 1024
) {
    init {
        require(maxFiles > 0) { "maxFiles 必须大于 0" }
        require(maxFileBytes >= 0) { "maxFileBytes 不能为负数" }
        require(maxTotalBytes >= 0) { "maxTotalBytes 不能为负数" }
        require(maxPathBytes > 0) { "maxPathBytes 必须大于 0" }
    }
}

data class CreateSnapshotCommand(
    val serverInstanceId: String,
    val files: List<SnapshotFile>,
    val source: SnapshotSource,
    val expectedManifestRevision: String? = null,
    val id: UUID = UUID.randomUUID(),
    val createdAt: Instant? = null
)
