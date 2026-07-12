package com.orryx.editor.audit

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresAuditRepository(private val database: R2dbcDatabase) : AuditRepository {
    override suspend fun append(event: AuditEvent) {
        require(event.eventType.isNotBlank()) { "eventType 不能为空" }
        database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO system_audit_events(id, event_type, actor, subject, details, created_at)
                    VALUES ($1, $2, $3, $4, CAST($5 AS JSONB), $6)
                    """.trimIndent()
                )
                    .bind(0, event.id)
                    .bind(1, event.eventType)
                    .bindNullable(2, event.actor)
                    .bindNullable(3, event.subject)
                    .bind(4, event.detailsJson)
                    .bind(5, event.createdAt)
            )
        }
    }

    override suspend fun recent(limit: Int): List<AuditEvent> {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        return database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    "SELECT id, event_type, actor, subject, details::text AS details, created_at FROM system_audit_events ORDER BY created_at DESC LIMIT $1"
                ).bind(0, limit)
            ) { row, _ -> row.toAuditEvent() }
        }
    }
}

private fun Row.toAuditEvent(): AuditEvent = AuditEvent(
    id = get("id", UUID::class.java)!!,
    eventType = get("event_type", String::class.java)!!,
    actor = get("actor", String::class.java),
    subject = get("subject", String::class.java),
    detailsJson = get("details", String::class.java)!!,
    createdAt = get("created_at", Instant::class.java)!!
)
