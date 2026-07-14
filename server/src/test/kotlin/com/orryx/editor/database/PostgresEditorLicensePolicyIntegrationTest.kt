package com.orryx.editor.database

import com.orryx.editor.claim.ClaimLicenseCommand
import com.orryx.editor.claim.ClaimService
import com.orryx.editor.claim.PostgresCommercialTransactionStore
import com.orryx.editor.config.DatabaseConfig
import com.orryx.editor.license.License
import com.orryx.editor.license.LicenseService
import com.orryx.editor.license.PostgresLicenseRepository
import com.orryx.editor.relay.EditorSessionRecord
import com.orryx.editor.session.PostgresRelayEditorSessionStore
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PostgresEditorLicensePolicyIntegrationTest {
    @Test
    fun `expired license keeps editor relay access without gaining commercial access`() = runBlocking {
        val url = System.getenv("TEST_DATABASE_URL")?.trim().orEmpty()
        assumeTrue("TEST_DATABASE_URL 未配置，跳过 PostgreSQL 集成测试", url.isNotEmpty())
        val database = R2dbcDatabase.create(
            DatabaseConfig(
                url = url,
                user = System.getenv("TEST_DATABASE_USER"),
                password = System.getenv("TEST_DATABASE_PASSWORD"),
                initialPoolSize = 1,
                maxPoolSize = 4,
                acquireTimeout = Duration.ofSeconds(10),
                idleTimeout = Duration.ofMinutes(2),
                statementTimeout = Duration.ofSeconds(30)
            )
        )

        try {
            assertTrue(database.warmUp() >= 1)
            DatabaseMigrator(database).migrate()

            val now = Instant.now()
            val repository = PostgresLicenseRepository(database)
            val license = repository.create(
                License(
                    license = "expired-${UUID.randomUUID()}",
                    owner = "editor-policy-integration",
                    createdAt = now.minusSeconds(86_400),
                    expiresAt = now.minusSeconds(60),
                    boundIps = emptyList(),
                    serverKey = "expired-server-${UUID.randomUUID()}",
                    enabled = true,
                    maxBoundIps = 1,
                    updatedAt = now
                )
            )
            val service = LicenseService(repository)
            assertNull(service.validate(license.license))
            assertNotNull(service.validateEditorAccess(license.license))

            val claim = ClaimService(PostgresCommercialTransactionStore(database)).claim(
                ClaimLicenseCommand(UUID.randomUUID().toString(), license.license)
            )
            assertEquals("LICENSE_NOT_FOUND_OR_INACTIVE", claim.outcome.name)

            val sessions = PostgresRelayEditorSessionStore(database)
            val tokenHash = sha256("expired-resume-${UUID.randomUUID()}")
            val record = EditorSessionRecord(
                licenseKey = license.license,
                browserId = "browser-${UUID.randomUUID()}",
                playerName = "ExpiredIntegrationPlayer",
                workspaceId = sha256("${license.serverKey}\u0000expired-integration"),
                serverKey = license.serverKey,
                serverId = "expired-integration",
                expiresAt = System.currentTimeMillis() + 60_000
            )
            sessions.save(tokenHash, record)
            assertNotNull(sessions.consume(tokenHash))
            assertNull(sessions.consume(tokenHash))

            assertTrue(service.revoke(license.license))
            val disabledSave = runCatching {
                sessions.save(sha256("disabled-resume-${UUID.randomUUID()}"), record)
            }
            assertTrue(disabledSave.exceptionOrNull() is IllegalArgumentException)
        } finally {
            database.closeAsync()
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
