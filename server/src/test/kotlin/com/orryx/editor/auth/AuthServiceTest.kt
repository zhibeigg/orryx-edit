package com.orryx.editor.auth

import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AuthServiceTest {
    private val now = Instant.parse("2025-01-01T00:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)

    @Test
    fun `normalizes email and authenticates active account`() = runTest {
        val service = AccountService(
            store = InMemoryAccountStore(),
            passwordHasher = Argon2idPasswordHasher(memoryKb = 1_024, iterations = 1),
            clock = clock,
            accountIdGenerator = { "00000000-0000-0000-0000-000000000001" }
        )

        val account = service.register(RegisterAccountCommand("  User.Name@Example.COM ", "correct horse", " User "))

        assertEquals("user.name@example.com", account.emailNormalized)
        assertEquals("User", account.displayName)
        assertNotNull(service.authenticate("USER.NAME@example.com", "correct horse"))
        assertNull(service.authenticate("user.name@example.com", "wrong password"))
        service.setStatus(account.id, AccountStatus.SUSPENDED)
        assertNull(service.authenticate("user.name@example.com", "correct horse"))
    }

    @Test
    fun `argon2id verifies password and rejects a different password`() {
        val hasher = Argon2idPasswordHasher(memoryKb = 1_024, iterations = 1)
        val encoded = hasher.hash("correct horse".toCharArray())

        assertTrue(encoded.startsWith("\$argon2id\$v=19\$"))
        assertTrue(hasher.verify("correct horse".toCharArray(), encoded))
        assertTrue(!hasher.verify("wrong password".toCharArray(), encoded))
    }

    @Test
    fun `session token can only be rotated once`() = runTest {
        var sequence = 1
        val service = SessionService(
            store = InMemorySessionStore(),
            clock = clock,
            lifetime = Duration.ofHours(1),
            sessionIdGenerator = {
                "00000000-0000-0000-0000-${(sequence++).toString().padStart(12, '0')}"
            }
        )
        val accountId = "10000000-0000-0000-0000-000000000001"
        val original = service.create(accountId)

        assertNotNull(service.validate(original.token, original.csrfToken))
        val replacement = assertNotNull(service.rotate(original.token))
        assertNotEquals(original.token, replacement.token)
        assertNull(service.rotate(original.token))
        assertNull(service.validate(original.token))
        assertNotNull(service.validate(replacement.token, replacement.csrfToken))
    }
}
