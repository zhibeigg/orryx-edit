package com.orryx.editor.release

import com.orryx.editor.snapshot.InMemorySnapshotRepository
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.snapshot.SnapshotSource
import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ReleaseSnapshotServiceTest {
    @Test
    fun `succeeded transaction creates release snapshot`() = runTest {
        val repository = InMemoryReleaseRepository()
        val content = "abc"
        val revision = SnapshotManifest.contentRevision(content)
        val releaseId = UUID.randomUUID()
        val transactionId = UUID.randomUUID()
        val targetManifest = SnapshotManifest.canonicalRevision(
            listOf(com.orryx.editor.snapshot.SnapshotFile("config.yml", revision, 3, content))
        )
        repository.create(
            CreateReleaseRecord(
                SignedRelease(
                    releaseId, ACCOUNT_ID, SERVER_ID, "stable", UUID.randomUUID(), UUID.randomUUID(), 1,
                    "1".repeat(64), targetManifest, "2".repeat(64), byteArrayOf(1), "sig", NOW
                ),
                listOf(ReleaseFile(releaseId, 0, "config.yml", null, revision, 3, content)),
                PluginReleaseTransaction(
                    transactionId, releaseId, SERVER_ID, "key", "3".repeat(64),
                    ReleaseTransactionStatus.QUEUED, 0, null, null, null, NOW, NOW, null
                )
            )
        )
        var stateVersion = 0L
        listOf(
            ReleaseTransactionStatus.PREPARE_DISPATCHED,
            ReleaseTransactionStatus.PREPARED,
            ReleaseTransactionStatus.COMMIT_DISPATCHED,
            ReleaseTransactionStatus.SUCCEEDED
        ).forEachIndexed { index, status ->
            val updated = assertIs<TransitionReleaseResult.Updated>(
                repository.transition(transactionId, stateVersion, status, NOW.plusSeconds(index + 1L))
            ).transaction
            stateVersion = updated.stateVersion
        }
        val snapshots = SnapshotService(InMemorySnapshotRepository(), clock = CLOCK)

        val snapshot = ReleaseSnapshotService(repository, snapshots, CLOCK)
            .createForSucceededTransaction(transactionId)

        assertEquals(SnapshotSource.RELEASE, snapshot.source)
        assertEquals(targetManifest, snapshot.manifestRevision)
        assertEquals(content, snapshot.files.single().content)
    }

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
        val CLOCK: Clock = Clock.fixed(NOW, ZoneOffset.UTC)
        const val ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"
        const val SERVER_ID = "00000000-0000-0000-0000-000000000002"
    }
}
