package com.orryx.editor.auth

import java.time.Instant

interface SessionStore {
    suspend fun create(record: SessionRecord): Boolean
    suspend fun validateAndTouch(tokenHash: String, csrfTokenHash: String?, now: Instant): SessionRecord?
    suspend fun rotate(tokenHash: String, replacement: SessionRecord, now: Instant): Boolean
    suspend fun revoke(tokenHash: String, now: Instant): Boolean
    suspend fun revokeAll(accountId: String, now: Instant): Int
    suspend fun cleanup(now: Instant): Int
}
