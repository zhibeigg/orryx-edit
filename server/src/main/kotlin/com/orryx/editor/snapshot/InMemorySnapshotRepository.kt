package com.orryx.editor.snapshot

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

class InMemorySnapshotRepository : SnapshotRepository {
    private val mutex = Mutex()
    private val snapshots = linkedMapOf<UUID, ServerSnapshot>()
    private val manifestIndex = mutableMapOf<Pair<String, String>, UUID>()

    override suspend fun create(snapshot: ServerSnapshot): ServerSnapshot = mutex.withLock {
        require(snapshot.serverInstanceId.isNotBlank()) { "serverInstanceId 不能为空" }
        SnapshotManifest.validateFiles(snapshot.files)
        require(snapshot.manifestRevision == SnapshotManifest.canonicalRevision(snapshot.files)) {
            "manifestRevision 与 canonical hash 不一致"
        }
        snapshots[snapshot.id]?.let { existing ->
            check(existing == snapshot) { "snapshot id 已存在且内容不同: ${snapshot.id}" }
            return@withLock existing.copy(files = existing.files.toList())
        }
        val manifestKey = snapshot.serverInstanceId to snapshot.manifestRevision
        manifestIndex[manifestKey]?.let { existingId ->
            return@withLock snapshots.getValue(existingId).copy(files = snapshots.getValue(existingId).files.toList())
        }
        val stored = snapshot.copy(files = snapshot.files.toList())
        snapshots[stored.id] = stored
        manifestIndex[manifestKey] = stored.id
        stored.copy(files = stored.files.toList())
    }

    override suspend fun find(id: UUID): ServerSnapshot? = mutex.withLock {
        snapshots[id]?.let { it.copy(files = it.files.toList()) }
    }

    override suspend fun findByManifest(serverInstanceId: String, manifestRevision: String): ServerSnapshot? = mutex.withLock {
        manifestIndex[serverInstanceId to manifestRevision]?.let(snapshots::get)?.let { it.copy(files = it.files.toList()) }
    }

    override suspend fun list(serverInstanceId: String?, limit: Int): List<ServerSnapshot> = mutex.withLock {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        snapshots.values.asSequence()
            .filter { serverInstanceId == null || it.serverInstanceId == serverInstanceId }
            .sortedWith(compareByDescending<ServerSnapshot> { it.createdAt }.thenBy { it.id })
            .take(limit)
            .map { it.copy(files = it.files.toList()) }
            .toList()
    }
}
