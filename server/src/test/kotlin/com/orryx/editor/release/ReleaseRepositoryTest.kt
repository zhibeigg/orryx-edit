package com.orryx.editor.release

import kotlinx.coroutines.test.runTest
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ReleaseRepositoryTest {
    @Test
    fun `postgres release repository remains loadable`() {
        assertEquals("PostgresReleaseRepository", PostgresReleaseRepository::class.simpleName)
    }

    @Test
    fun `create is idempotent and only one active transaction exists per instance`() = runTest {
        val repository = InMemoryReleaseRepository()
        val first = record(idempotencyKey = "publish-1", fingerprint = "a".repeat(64))

        assertFalse(assertIs<CreateReleaseResult.Created>(repository.create(first)).replayed)
        assertEquals(listOf(first.release.id), repository.listReleases(ACCOUNT_ID, SERVER_ID, first.release.draftId).map(SignedRelease::id))
        assertEquals(listOf(first.transaction.id), repository.listTransactions(ACCOUNT_ID, SERVER_ID, ReleaseTransactionStatus.QUEUED).map(PluginReleaseTransaction::id))
        val replayReleaseId = UUID.randomUUID()
        val replayRecord = first.copy(
            release = first.release.copy(id = replayReleaseId),
            files = first.files.map { it.copy(releaseId = replayReleaseId) },
            transaction = first.transaction.copy(id = UUID.randomUUID(), releaseId = replayReleaseId)
        )
        assertTrue(assertIs<CreateReleaseResult.Created>(repository.create(replayRecord)).replayed)
        assertIs<CreateReleaseResult.IdempotencyConflict>(
            repository.create(first.copy(transaction = first.transaction.copy(requestFingerprint = "b".repeat(64))))
        )
        assertIs<CreateReleaseResult.ActiveTransactionConflict>(
            repository.create(record(idempotencyKey = "publish-2", fingerprint = "c".repeat(64)))
        )
    }

    @Test
    fun `lease cas legal transitions and event idempotency are enforced`() = runTest {
        val repository = InMemoryReleaseRepository()
        val record = record()
        repository.create(record)

        val claimed = assertNotNull(repository.claimNext("worker-1", NOW, Duration.ofSeconds(30)))
        assertEquals(1, claimed.stateVersion)
        assertEquals("worker-1", claimed.leaseOwner)
        assertNull(repository.claimNext("worker-2", NOW.plusSeconds(10), Duration.ofSeconds(30)))
        val reclaimed = assertNotNull(repository.claimNext("worker-2", NOW.plusSeconds(31), Duration.ofSeconds(30)))
        assertEquals(2, reclaimed.stateVersion)
        assertEquals("worker-2", reclaimed.leaseOwner)

        assertIs<TransitionReleaseResult.Conflict>(
            repository.transition(record.transaction.id, 1, ReleaseTransactionStatus.PREPARE_DISPATCHED, NOW.plusSeconds(32))
        )
        val preparedDispatch = assertIs<TransitionReleaseResult.Updated>(
            repository.transition(
                record.transaction.id,
                2,
                ReleaseTransactionStatus.PREPARE_DISPATCHED,
                NOW.plusSeconds(32),
                leaseOwner = "worker-2"
            )
        ).transaction
        assertEquals(3, preparedDispatch.stateVersion)
        assertEquals("worker-2", preparedDispatch.leaseOwner)
        assertNotNull(preparedDispatch.leaseExpiresAt)
        assertNull(repository.claimNext("worker-3", NOW.plusSeconds(33), Duration.ofSeconds(30)))
        val pluginPrepared = assertIs<TransitionReleaseResult.Updated>(
            repository.transition(
                record.transaction.id,
                3,
                ReleaseTransactionStatus.PREPARED,
                NOW.plusSeconds(34)
            )
        ).transaction
        assertNull(pluginPrepared.leaseOwner)
        assertNull(pluginPrepared.leaseExpiresAt)
        val commitClaim = assertNotNull(
            repository.claimNext("worker-3", NOW.plusSeconds(35), Duration.ofSeconds(30))
        )
        assertEquals(5, commitClaim.stateVersion)
        assertEquals("worker-3", commitClaim.leaseOwner)
        assertIs<TransitionReleaseResult.IllegalTransition>(
            repository.transition(
                record.transaction.id,
                5,
                ReleaseTransactionStatus.SUCCEEDED,
                NOW.plusSeconds(36),
                leaseOwner = "worker-3"
            )
        )

        val event = ReleaseEventFactory.create(record.transaction.id, 1, "prepare:sent", "PREPARE_SENT", "{}", NOW)
        assertFalse(assertIs<AppendReleaseEventResult.Appended>(repository.appendEvent(event)).replayed)
        assertTrue(assertIs<AppendReleaseEventResult.Appended>(repository.appendEvent(event)).replayed)
        assertIs<AppendReleaseEventResult.IdempotencyConflict>(
            repository.appendEvent(event.copy(payload = "changed", payloadFingerprint = "d".repeat(64)))
        )
        assertEquals(listOf(event), repository.listEvents(record.transaction.id))
    }

    @Test
    fun `transfer grants authorize expire and revoke by token hash`() = runTest {
        val repository = InMemoryReleaseRepository()
        val record = record()
        repository.create(record)
        val hash = ReleaseTransferToken.hash("secret-transfer-token")
        val grant = ReleaseTransferGrant(
            UUID.randomUUID(),
            record.release.id,
            hash,
            SERVER_ID,
            NOW.plusSeconds(60),
            NOW,
            null
        )
        repository.grantTransfer(grant)

        assertNotNull(repository.authorizeTransfer(record.release.id, hash, SERVER_ID, NOW.plusSeconds(30)))
        assertNull(repository.authorizeTransfer(record.release.id, hash, SERVER_ID, NOW.plusSeconds(61)))
        assertTrue(repository.revokeTransfer(grant.id, NOW.plusSeconds(40)))
        assertNull(repository.authorizeTransfer(record.release.id, hash, SERVER_ID, NOW.plusSeconds(41)))
    }

    private fun record(
        idempotencyKey: String = "publish-1",
        fingerprint: String = "a".repeat(64)
    ): CreateReleaseRecord {
        val releaseId = UUID.randomUUID()
        val release = SignedRelease(
            id = releaseId,
            accountId = ACCOUNT_ID,
            serverInstanceId = SERVER_ID,
            stableServerId = "stable-server",
            draftId = UUID.randomUUID(),
            draftVersionId = UUID.randomUUID(),
            draftVersionNumber = 1,
            expectedBaseManifestRevision = "1".repeat(64),
            targetManifestRevision = "2".repeat(64),
            keyId = "3".repeat(64),
            canonicalPayload = byteArrayOf(1, 2, 3),
            signature = "signature",
            createdAt = NOW
        )
        return CreateReleaseRecord(
            release,
            listOf(ReleaseFile(releaseId, 0, "config.yml", "1".repeat(64), "2".repeat(64), 3, "abc")),
            PluginReleaseTransaction(
                UUID.randomUUID(), releaseId, SERVER_ID, idempotencyKey, fingerprint,
                ReleaseTransactionStatus.QUEUED, 0, null, null, null, NOW, NOW, null
            )
        )
    }

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
        const val ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"
        const val SERVER_ID = "00000000-0000-0000-0000-000000000002"
    }
}
