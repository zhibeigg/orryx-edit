package com.orryx.editor.release

import com.orryx.editor.draft.AppendDraftVersionCommand
import com.orryx.editor.draft.CreateDraftCommand
import com.orryx.editor.draft.DraftMaterializer
import com.orryx.editor.draft.DraftService
import com.orryx.editor.draft.InMemoryDraftRepository
import com.orryx.editor.snapshot.CreateSnapshotCommand
import com.orryx.editor.snapshot.InMemorySnapshotRepository
import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.snapshot.SnapshotSource
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import com.orryx.editor.versioning.DraftVersionSource
import kotlinx.coroutines.test.runTest
import java.security.KeyPairGenerator
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ReleaseServiceTest {
    @Test
    fun `publish signs full current target and replays idempotency key`() = runTest {
        val snapshots = InMemorySnapshotRepository()
        val snapshotService = SnapshotService(snapshots, clock = CLOCK)
        val baseContent = "value: base\n"
        val unchangedContent = "keep: true\n"
        val base = snapshotService.createSnapshot(
            CreateSnapshotCommand(
                SERVER_ID,
                listOf(
                    snapshotFile("config.yml", baseContent),
                    snapshotFile("unchanged.yml", unchangedContent),
                ),
                SnapshotSource.PLUGIN,
                createdAt = NOW
            )
        )
        val draftRepository = InMemoryDraftRepository()
        val draftService = DraftService(draftRepository, snapshots, clock = CLOCK)
        val draft = draftService.createDraft(CreateDraftCommand(ACCOUNT_ID, SERVER_ID, base.id, "publish", createdAt = NOW))
        val targetContent = "value: target\n"
        val versionId = UUID.randomUUID()
        draftService.appendVersion(
            AppendDraftVersionCommand(
                draft.id,
                0,
                listOf(
                    DraftFile(
                        DraftFileChangeType.UPSERT,
                        "config.yml",
                        SnapshotManifest.contentRevision(baseContent),
                        SnapshotManifest.contentRevision(targetContent),
                        targetContent.toByteArray().size.toLong(),
                        targetContent
                    )
                ),
                DraftVersionSource.MANUAL,
                ACCOUNT_ID,
                versionId,
                NOW.plusSeconds(1)
            )
        )
        val pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val signer = Ed25519ReleaseSigner.fromPkcs8AndX509(pair.private.encoded, pair.public.encoded)
        val repository = InMemoryReleaseRepository()
        val service = ReleaseService(
            draftRepository,
            DraftMaterializer(draftRepository, snapshots),
            repository,
            signer,
            ReleaseServerAccess { account, instance ->
                ReleaseServerIdentity(instance, "stable-server").takeIf { account == ACCOUNT_ID && instance == SERVER_ID }
            },
            CLOCK
        )
        val command = PublishReleaseCommand(
            ACCOUNT_ID,
            SERVER_ID,
            draft.id,
            versionId,
            1,
            base.manifestRevision,
            "publish-once",
            createdAt = NOW.plusSeconds(2)
        )

        val first = assertIs<PublishReleaseResult.Accepted>(service.publish(command))
        val version2Content = "value: later\n"
        val version2Id = UUID.randomUUID()
        draftService.appendVersion(
            AppendDraftVersionCommand(
                draft.id,
                1,
                listOf(
                    DraftFile(
                        DraftFileChangeType.UPSERT,
                        "config.yml",
                        SnapshotManifest.contentRevision(targetContent),
                        SnapshotManifest.contentRevision(version2Content),
                        version2Content.toByteArray().size.toLong(),
                        version2Content
                    )
                ),
                DraftVersionSource.MANUAL,
                ACCOUNT_ID,
                version2Id,
                NOW.plusSeconds(3)
            )
        )
        val replay = assertIs<PublishReleaseResult.Accepted>(
            service.publish(command.copy(releaseId = UUID.randomUUID(), transactionId = UUID.randomUUID()))
        )
        assertIs<PublishReleaseResult.IdempotencyConflict>(
            service.publish(
                command.copy(
                    draftVersionId = version2Id,
                    expectedCurrentVersion = 2,
                    releaseId = UUID.randomUUID(),
                    transactionId = UUID.randomUUID()
                )
            )
        )

        assertTrue(signer.verify(first.release.canonicalPayload, first.release.signature))
        assertEquals(first.release.id, replay.release.id)
        assertTrue(replay.replayed)
        val releaseFiles = repository.listFiles(first.release.id)
        assertEquals(listOf("config.yml", "unchanged.yml"), releaseFiles.map(ReleaseFile::path))
        assertEquals(targetContent, releaseFiles.single { it.path == "config.yml" }.content)
        val unchanged = releaseFiles.single { it.path == "unchanged.yml" }
        assertEquals(unchangedContent, unchanged.content)
        assertEquals(SnapshotManifest.contentRevision(unchangedContent), unchanged.contentRevision)
        assertTrue(releaseFiles.all { it.changeType == ReleaseFileChangeType.UPSERT })
        assertEquals(base.manifestRevision, first.release.expectedBaseManifestRevision)
    }

    private fun snapshotFile(path: String, content: String): SnapshotFile =
        SnapshotFile(path, SnapshotManifest.contentRevision(content), content.toByteArray().size.toLong(), content)

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
        val CLOCK: Clock = Clock.fixed(NOW, ZoneOffset.UTC)
        const val ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"
        const val SERVER_ID = "00000000-0000-0000-0000-000000000002"
    }
}
