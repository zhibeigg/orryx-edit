package com.orryx.editor.session

import java.time.Duration
import java.time.Instant
import java.util.UUID

data class EditorSession(
    val id: UUID,
    val licenseKey: String,
    val workspaceId: String,
    val serverKey: String,
    val serverId: String,
    val playerName: String,
    val browserId: String,
    val resumeTokenHash: String,
    val createdAt: Instant,
    val lastSeenAt: Instant,
    val expiresAt: Instant,
    val revokedAt: Instant?
)

data class CreateEditorSessionCommand(
    val licenseKey: String,
    val workspaceId: String,
    val serverKey: String,
    val serverId: String,
    val playerName: String,
    val browserId: String,
    val resumeToken: String,
    val now: Instant,
    val ttl: Duration
)

interface EditorSessionRepository {
    suspend fun create(command: CreateEditorSessionCommand): EditorSession
    suspend fun findByResumeToken(resumeToken: String, now: Instant): EditorSession?
    suspend fun touch(id: UUID, now: Instant, expiresAt: Instant): Boolean
    suspend fun rotate(resumeToken: String, replacementToken: String, now: Instant, expiresAt: Instant): EditorSession?
    suspend fun revoke(id: UUID, now: Instant): Boolean
    suspend fun cleanup(now: Instant): Long
}
