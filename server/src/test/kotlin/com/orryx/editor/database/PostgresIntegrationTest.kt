package com.orryx.editor.database

import com.orryx.editor.config.DatabaseConfig
import com.orryx.editor.license.CreateLicenseCommand
import com.orryx.editor.license.LicenseService
import com.orryx.editor.license.PostgresLicenseRepository
import com.orryx.editor.relay.EditorSessionRecord
import com.orryx.editor.session.PostgresRelayEditorSessionStore
import com.orryx.editor.update.PostgresUpdateJobStore
import com.orryx.editor.update.UpdateJob
import com.orryx.editor.update.UpdateJobAction
import com.orryx.editor.update.UpdateJobStatus
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import java.security.MessageDigest
import java.time.Duration
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PostgresIntegrationTest {
    @Test
    fun `migrations repositories sessions and update jobs work on PostgreSQL`() = runBlocking {
        val url = System.getenv("TEST_DATABASE_URL")?.trim().orEmpty()
        assumeTrue("TEST_DATABASE_URL 未配置，跳过 PostgreSQL 集成测试", url.isNotEmpty())
        val database = R2dbcDatabase.create(
            DatabaseConfig(
                url = url,
                user = System.getenv("TEST_DATABASE_USER"),
                password = System.getenv("TEST_DATABASE_PASSWORD"),
                initialPoolSize = 1,
                maxPoolSize = 6,
                acquireTimeout = Duration.ofSeconds(10),
                idleTimeout = Duration.ofMinutes(2),
                statementTimeout = Duration.ofSeconds(30)
            )
        )

        try {
            assertTrue(database.warmUp() >= 1)
            coroutineScope {
                listOf(
                    async { DatabaseMigrator(database).migrate() },
                    async { DatabaseMigrator(database).migrate() }
                ).awaitAll()
            }
            assertTrue(database.ping())

            val service = LicenseService(PostgresLicenseRepository(database))
            val license = service.create(
                CreateLicenseCommand(
                    owner = "integration-${UUID.randomUUID()}",
                    days = 30,
                    maxBoundIps = 1
                )
            )
            assertNotNull(service.validate(license.license))
            assertTrue(service.addIp(license.license, "127.0.0.1").name in setOf("ADDED", "ALREADY_BOUND"))
            assertEquals("LIMIT_REACHED", service.addIp(license.license, "127.0.0.2").name)

            val relaySessions = PostgresRelayEditorSessionStore(database)
            val rawResumeToken = "resume-${UUID.randomUUID()}"
            val tokenHash = sha256(rawResumeToken)
            relaySessions.save(
                tokenHash,
                EditorSessionRecord(
                    licenseKey = license.license,
                    browserId = "browser-${UUID.randomUUID()}",
                    playerName = "IntegrationPlayer",
                    workspaceId = sha256("${license.serverKey}\u0000integration"),
                    serverKey = license.serverKey,
                    serverId = "integration",
                    expiresAt = System.currentTimeMillis() + 60_000
                )
            )
            assertNotNull(relaySessions.consume(tokenHash))
            assertNull(relaySessions.consume(tokenHash))

            val instanceId = "integration-${UUID.randomUUID()}"
            val updateStore = PostgresUpdateJobStore(database, instanceId)
            val now = System.currentTimeMillis()
            val job = updateStore.create(
                UpdateJob(
                    id = UUID.randomUUID().toString(),
                    action = UpdateJobAction.CHECK,
                    status = UpdateJobStatus.QUEUED,
                    currentVersion = "0.3.1",
                    deployment = "source",
                    createdAt = now,
                    updatedAt = now
                )
            )
            assertEquals(job.id, updateStore.active()?.id)
            updateStore.update(job.copy(status = UpdateJobStatus.SUCCEEDED, progress = 100, updatedAt = now + 1))
            assertNull(updateStore.active())
            assertEquals(UpdateJobStatus.SUCCEEDED, updateStore.get(job.id)?.status)
        } finally {
            database.closeAsync()
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
