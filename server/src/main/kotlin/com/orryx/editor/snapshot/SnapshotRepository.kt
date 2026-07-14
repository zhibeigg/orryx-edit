package com.orryx.editor.snapshot

import java.util.UUID

interface SnapshotReader {
    suspend fun find(id: UUID): ServerSnapshot?
    suspend fun findByManifest(serverInstanceId: String, manifestRevision: String): ServerSnapshot?
    suspend fun list(serverInstanceId: String? = null, limit: Int = 100): List<ServerSnapshot>
}

interface SnapshotRepository : SnapshotReader {
    suspend fun create(snapshot: ServerSnapshot): ServerSnapshot
}
