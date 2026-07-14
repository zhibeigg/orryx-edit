package com.orryx.editor.database

import com.orryx.editor.ai.AiAccessRequest
import com.orryx.editor.ai.AiJobRepository
import com.orryx.editor.ai.AiOperation
import com.orryx.editor.ai.AiProviderUsage
import com.orryx.editor.ai.CreateAiJobCommand
import com.orryx.editor.ai.DraftArtifactRequest
import com.orryx.editor.ai.PostgresAiAccessPolicy
import com.orryx.editor.ai.PostgresAiJobRepository
import com.orryx.editor.auth.AccountService
import com.orryx.editor.auth.Argon2idPasswordHasher
import com.orryx.editor.auth.PostgresAccountStore
import com.orryx.editor.auth.PostgresSessionStore
import com.orryx.editor.auth.RegisterAccountCommand
import com.orryx.editor.auth.SessionService
import com.orryx.editor.claim.ClaimLicenseCommand
import com.orryx.editor.claim.ClaimService
import com.orryx.editor.claim.PostgresCommercialTransactionStore
import com.orryx.editor.claim.RegisterServerCommand
import com.orryx.editor.config.DatabaseConfig
import com.orryx.editor.draft.CreateDraftCommand
import com.orryx.editor.draft.DraftArtifactSinkAdapter
import com.orryx.editor.draft.DraftService
import com.orryx.editor.draft.PostgresDraftRepository
import com.orryx.editor.entitlement.EntitlementType
import com.orryx.editor.entitlement.PostgresEntitlementStore
import com.orryx.editor.ketherdocs.CachedKetherDocs
import com.orryx.editor.ketherdocs.PostgresKetherDocsRepository
import com.orryx.editor.ketherdocs.StoredKetherDocsSyncState
import com.orryx.editor.license.CreateLicenseCommand
import com.orryx.editor.license.LicenseService
import com.orryx.editor.license.PostgresLicenseRepository
import com.orryx.editor.payment.PaymentOrder
import com.orryx.editor.payment.PaymentOrderStatus
import com.orryx.editor.payment.PaymentProviderType
import com.orryx.editor.payment.PostgresPaymentSettlementStore
import com.orryx.editor.payment.ProductId
import com.orryx.editor.payment.ValidatedPaymentNotification
import com.orryx.editor.relay.EditorSessionRecord
import com.orryx.editor.session.PostgresRelayEditorSessionStore
import com.orryx.editor.snapshot.CreateSnapshotCommand
import com.orryx.editor.snapshot.PostgresSnapshotRepository
import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.snapshot.SnapshotSource
import com.orryx.editor.update.PostgresUpdateJobStore
import com.orryx.editor.update.UpdateJob
import com.orryx.editor.update.UpdateJobAction
import com.orryx.editor.update.UpdateJobStatus
import com.orryx.editor.wallet.PostgresWalletStore
import com.orryx.editor.wallet.WalletService
import kotlinx.coroutines.async
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
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

            val accountService = AccountService(
                PostgresAccountStore(database),
                Argon2idPasswordHasher(memoryKb = 1_024, iterations = 1)
            )
            val account = accountService.register(
                RegisterAccountCommand("integration-${UUID.randomUUID()}@example.com", "integration-password", "Integration")
            )
            assertNotNull(accountService.authenticate(account.email, "integration-password"))
            val accountSessions = SessionService(PostgresSessionStore(database), lifetime = Duration.ofMinutes(5))
            val issuedSession = accountSessions.create(account.id)
            assertNotNull(accountSessions.validate(issuedSession.token, issuedSession.csrfToken))

            val claimService = ClaimService(PostgresCommercialTransactionStore(database))
            val claim = claimService.claim(ClaimLicenseCommand(account.id, license.license))
            assertEquals("CLAIMED", claim.outcome.name)
            val server = assertNotNull(
                claimService.registerServer(
                    RegisterServerCommand(account.id, license.license, "integration-${UUID.randomUUID()}", "Integration Server")
                ).instance
            )
            assertTrue(claimService.canAccessServer(account.id, server.id))

            val paymentStore = PostgresPaymentSettlementStore(database)
            val paymentOrder = PaymentOrder(
                id = UUID.randomUUID().toString(),
                merchantOrderNo = "ORYX${UUID.randomUUID().toString().replace("-", "").uppercase()}",
                requestKey = "integration:${UUID.randomUUID()}",
                accountId = account.id,
                productId = ProductId.AI_PERMANENT_99,
                provider = PaymentProviderType.ALIPAY,
                amountCents = 9_900,
                giftCents = 5_000,
                status = PaymentOrderStatus.PENDING,
                createdAt = Instant.now()
            )
            paymentStore.createOrder(paymentOrder)
            paymentStore.settlePaid(
                ValidatedPaymentNotification(
                    paymentOrder.merchantOrderNo,
                    "ALI${UUID.randomUUID().toString().replace("-", "").uppercase()}",
                    paymentOrder.amountCents,
                    "TRADE_SUCCESS"
                ),
                Instant.now(),
                UUID.randomUUID().toString(),
                UUID.randomUUID().toString()
            )
            assertNotNull(PostgresEntitlementStore(database).find(account.id, EntitlementType.AI_EDITOR_PERMANENT))
            val wallet = WalletService(PostgresWalletStore(database))
            assertEquals(5_000, wallet.balance(account.id).giftCents)

            val snapshotRepository = PostgresSnapshotRepository(database)
            val snapshots = SnapshotService(snapshotRepository)
            val baseContent = "value: integration\n"
            val baseRevision = SnapshotManifest.contentRevision(baseContent)
            val snapshot = snapshots.createSnapshot(
                CreateSnapshotCommand(
                    serverInstanceId = server.id,
                    files = listOf(
                        SnapshotFile("config.yml", baseRevision, baseContent.toByteArray().size.toLong(), baseContent)
                    ),
                    source = SnapshotSource.IMPORT
                )
            )
            val drafts = DraftService(PostgresDraftRepository(database), snapshotRepository)
            val draft = drafts.createDraft(CreateDraftCommand(account.id, server.id, snapshot.id, "Integration draft"))

            database.withConnection { connection ->
                executeFully(
                    connection.createStatement(
                        """
                        INSERT INTO ai_providers(
                            provider_id, provider_type, display_name, base_url, default_model,
                            enabled, config, created_at, updated_at
                        ) VALUES ('integration', 'OPENAI_COMPATIBLE', 'Integration', 'https://example.com/v1',
                            'integration-model', TRUE, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (provider_id) DO NOTHING
                        """.trimIndent()
                    )
                )
            }
            val aiJobs: AiJobRepository = PostgresAiJobRepository(database)
            val aiJob = aiJobs.create(
                CreateAiJobCommand(
                    accountId = UUID.fromString(account.id),
                    serverInstanceId = UUID.fromString(server.id),
                    draftId = draft.id,
                    operation = AiOperation.PLAN,
                    prompt = "integration plan",
                    providerId = "integration",
                    model = "integration-model",
                    idempotencyKey = "integration:${UUID.randomUUID()}"
                )
            )
            val accessPolicy = PostgresAiAccessPolicy(database, reservationCents = 10)
            val reservation = accessPolicy.authorize(
                AiAccessRequest(
                    aiJob.id,
                    aiJob.accountId,
                    aiJob.serverInstanceId,
                    aiJob.providerId,
                    aiJob.model,
                    aiJob.operation,
                    aiJob.idempotencyKey
                )
            )
            val artifact = DraftArtifactSinkAdapter(drafts).store(
                DraftArtifactRequest(
                    aiJob.id,
                    aiJob.accountId,
                    aiJob.serverInstanceId,
                    aiJob.draftId,
                    aiJob.baseVersionId,
                    aiJob.operation,
                    buildJsonObject { put("plan", "integration") }
                )
            )
            assertTrue(artifact.artifactId.isNotBlank())
            accessPolicy.capture(reservation, AiProviderUsage(10, 5), costAmount = 1, now = Instant.now())
            assertEquals(4_999, wallet.balance(account.id).giftCents)
            assertEquals(1, drafts.get(draft.id)?.currentVersion)

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

            val ketherDocs = PostgresKetherDocsRepository(database)
            val docsNow = java.time.Instant.now().truncatedTo(ChronoUnit.MICROS)
            val schemaJson = "{\"version\":2}"
            val cache = CachedKetherDocs(
                channel = "stable",
                releaseId = "Orryx@2.43.114+${"a".repeat(40)}",
                pluginVersion = "2.43.114",
                commit = "a".repeat(40),
                schemaVersion = 3,
                schemaSha256 = sha256(schemaJson),
                schemaBytes = schemaJson.toByteArray().size.toLong(),
                schemaJson = schemaJson,
                publishedAt = docsNow,
                syncedAt = docsNow
            )
            val syncState = StoredKetherDocsSyncState(
                channel = "stable",
                lastAttemptAt = docsNow,
                lastSuccessAt = docsNow,
                nextAttemptAt = docsNow.plusSeconds(43_200),
                errorCode = null
            )
            ketherDocs.saveSuccess(cache, syncState)
            assertEquals(cache.releaseId, ketherDocs.load("stable")?.releaseId)
            assertEquals(syncState.nextAttemptAt, ketherDocs.loadState("stable")?.nextAttemptAt)
        } finally {
            database.closeAsync()
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
