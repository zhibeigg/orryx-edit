package com.orryx.editor.audit

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class InMemoryAuditRepository : AuditRepository {
    private val mutex = Mutex()
    private val events = mutableListOf<AuditEvent>()

    override suspend fun append(event: AuditEvent) {
        mutex.withLock { events += event }
    }

    override suspend fun recent(limit: Int): List<AuditEvent> = mutex.withLock {
        events.sortedByDescending { it.createdAt }.take(limit)
    }
}
