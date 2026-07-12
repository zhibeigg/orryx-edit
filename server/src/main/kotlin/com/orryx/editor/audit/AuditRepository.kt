package com.orryx.editor.audit

import java.time.Instant
import java.util.UUID

data class AuditEvent(
    val id: UUID = UUID.randomUUID(),
    val eventType: String,
    val actor: String? = null,
    val subject: String? = null,
    val detailsJson: String = "{}",
    val createdAt: Instant
)

interface AuditRepository {
    suspend fun append(event: AuditEvent)
    suspend fun recent(limit: Int = 100): List<AuditEvent>
}
