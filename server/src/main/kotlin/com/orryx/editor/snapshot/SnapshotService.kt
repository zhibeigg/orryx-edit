package com.orryx.editor.snapshot

import java.time.Clock
import java.util.UUID

class SnapshotService(
    private val repository: SnapshotRepository,
    private val limits: SnapshotLimits = SnapshotLimits(),
    private val clock: Clock = Clock.systemUTC()
) {
    suspend fun createSnapshot(command: CreateSnapshotCommand): ServerSnapshot {
        require(command.serverInstanceId.isNotBlank()) { "serverInstanceId 不能为空" }
        SnapshotManifest.validateFiles(command.files, limits)
        val manifestRevision = SnapshotManifest.canonicalRevision(command.files, limits)
        command.expectedManifestRevision?.let { expected ->
            require(SnapshotManifest.isSha256(expected)) { "expectedManifestRevision 必须是 64 位小写 SHA-256" }
            require(expected == manifestRevision) { "manifestRevision 与 canonical hash 不一致" }
        }
        repository.findByManifest(command.serverInstanceId, manifestRevision)?.let { return it }
        return repository.create(
            ServerSnapshot(
                id = command.id,
                serverInstanceId = command.serverInstanceId,
                manifestRevision = manifestRevision,
                files = command.files.toList(),
                source = command.source,
                createdAt = command.createdAt ?: clock.instant()
            )
        )
    }

    suspend fun get(id: UUID): ServerSnapshot? = repository.find(id)

    suspend fun list(serverInstanceId: String? = null, limit: Int = 100): List<ServerSnapshot> =
        repository.list(serverInstanceId, limit)
}
