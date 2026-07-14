package com.orryx.editor.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.util.Base64
import java.util.UUID

class SessionService(
    private val store: SessionStore,
    private val clock: Clock = Clock.systemUTC(),
    private val lifetime: Duration = Duration.ofDays(30),
    private val secureRandom: SecureRandom = SecureRandom(),
    private val sessionIdGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    init {
        require(!lifetime.isNegative && !lifetime.isZero && lifetime <= Duration.ofDays(365)) {
            "session lifetime must be between 1 nanosecond and 365 days"
        }
    }

    suspend fun create(accountId: String): IssuedSession {
        val normalizedAccountId = UUID.fromString(accountId).toString()
        repeat(3) {
            val issued = newSession(normalizedAccountId, rotatedFromId = null)
            if (store.create(issued.record)) return issued.issued
        }
        error("unable to allocate a unique session token")
    }

    suspend fun validate(token: String, csrfToken: String? = null): SessionView? {
        if (!isValidRawToken(token) || (csrfToken != null && !isValidRawToken(csrfToken))) return null
        return store.validateAndTouch(
            tokenHash = hashToken(token),
            csrfTokenHash = csrfToken?.let(::hashToken),
            now = clock.instant()
        )?.view
    }

    suspend fun rotate(token: String): IssuedSession? {
        if (!isValidRawToken(token)) return null
        val now = clock.instant()
        val current = store.validateAndTouch(hashToken(token), csrfTokenHash = null, now = now) ?: return null
        repeat(3) {
            val replacement = newSession(current.view.accountId, current.view.id, now)
            if (store.rotate(hashToken(token), replacement.record, now)) return replacement.issued
        }
        return null
    }

    suspend fun revoke(token: String): Boolean =
        isValidRawToken(token) && store.revoke(hashToken(token), clock.instant())

    suspend fun revokeAll(accountId: String): Int =
        store.revokeAll(UUID.fromString(accountId).toString(), clock.instant())

    suspend fun cleanup(): Int = store.cleanup(clock.instant())

    private fun newSession(
        accountId: String,
        rotatedFromId: String?,
        now: java.time.Instant = clock.instant()
    ): NewSession {
        val token = randomToken()
        val csrfToken = randomToken()
        val view = SessionView(
            id = UUID.fromString(sessionIdGenerator()).toString(),
            accountId = accountId,
            createdAt = now,
            lastSeenAt = now,
            expiresAt = now.plus(lifetime),
            rotatedFromId = rotatedFromId
        )
        val record = SessionRecord(view, hashToken(token), hashToken(csrfToken))
        return NewSession(record, IssuedSession(token, csrfToken, view))
    }

    private fun randomToken(): String = ByteArray(TOKEN_BYTES).let { bytes ->
        try {
            secureRandom.nextBytes(bytes)
            Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        } finally {
            bytes.fill(0)
        }
    }

    private fun isValidRawToken(token: String): Boolean = token.length in 40..128 && TOKEN_PATTERN.matches(token)

    private fun hashToken(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private data class NewSession(val record: SessionRecord, val issued: IssuedSession)

    private companion object {
        const val TOKEN_BYTES = 32
        val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]+$")
    }
}
