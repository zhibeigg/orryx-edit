package com.orryx.editor.draft

import com.orryx.editor.ai.AiOperation
import com.orryx.editor.ai.DraftArtifactRequest
import com.orryx.editor.snapshot.CreateSnapshotCommand
import com.orryx.editor.snapshot.InMemorySnapshotRepository
import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.snapshot.SnapshotSource
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import com.orryx.editor.versioning.DraftVersionSource
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class DraftServiceTest {
    @Test
    fun `versions are immutable and cas conflict is stable`() = runTest {
        val fixture = fixture()
        val draft = fixture.createDraft()
        val replacement = "value: two\n"
        val versionId = UUID.randomUUID()
        val command = AppendDraftVersionCommand(
            id = versionId,
            draftId = draft.id,
            expectedCurrentVersion = 0,
            files = listOf(fixture.upsert(replacement)),
            source = DraftVersionSource.MANUAL,
            authorAccountId = "account-1",
            createdAt = NOW.plusSeconds(1)
        )

        val created = assertIs<AppendVersionResult.Created>(fixture.drafts.appendVersion(command)).stored
        assertEquals(1, created.version.versionNumber)
        assertNull(created.version.parentVersionId)
        assertEquals(1, fixture.drafts.get(draft.id)?.currentVersion)

        val conflict = assertIs<AppendVersionResult.Conflict>(
            fixture.drafts.appendVersion(
                command.copy(
                    id = UUID.randomUUID(),
                    files = listOf(fixture.upsert("value: three\n")),
                    createdAt = NOW.plusSeconds(2)
                )
            )
        )
        assertEquals(0, conflict.expectedCurrentVersion)
        assertEquals(1, conflict.actualCurrentVersion)
        assertEquals(created, fixture.drafts.getVersion(versionId))
    }

    @Test
    fun `replaying same version id is idempotent`() = runTest {
        val fixture = fixture()
        val draft = fixture.createDraft()
        val command = AppendDraftVersionCommand(
            id = UUID.randomUUID(),
            draftId = draft.id,
            expectedCurrentVersion = 0,
            files = listOf(fixture.upsert("value: replay\n")),
            source = DraftVersionSource.IMPORT,
            authorAccountId = "account-1",
            createdAt = NOW.plusSeconds(1)
        )

        val first = assertIs<AppendVersionResult.Created>(fixture.drafts.appendVersion(command)).stored
        val replay = assertIs<AppendVersionResult.Created>(fixture.drafts.appendVersion(command)).stored

        assertEquals(first, replay)
        assertEquals(1, fixture.drafts.listVersions(draft.id).size)
    }

    @Test
    fun `ai artifacts only append a draft version and never mutate server snapshot`() = runTest {
        val fixture = fixture()
        val draft = fixture.createDraft()
        val before = fixture.snapshots.get(fixture.snapshotId)

        val result = assertIs<AppendVersionResult.Created>(
            fixture.drafts.appendAiArtifacts(
                draftId = draft.id,
                expectedVersion = 0,
                authorAccountId = "account-ai",
                files = listOf(AiDraftArtifact("config.yml", "value: ai\n", fixture.baseRevision))
            )
        )

        assertEquals(DraftVersionSource.AI, result.stored.version.source)
        assertEquals(before, fixture.snapshots.get(fixture.snapshotId))
        assertEquals(1, fixture.snapshots.list().size)
        assertEquals(1, fixture.drafts.get(draft.id)?.currentVersion)
    }

    @Test
    fun `fallback ai artifact uses a snapshot-safe path`() = runTest {
        val accountId = UUID.randomUUID()
        val serverInstanceId = UUID.randomUUID()
        val fixture = fixture(accountId.toString(), serverInstanceId.toString())
        val draft = fixture.createDraft()
        val jobId = UUID.randomUUID()

        val artifact = DraftArtifactSinkAdapter(fixture.drafts).store(
            DraftArtifactRequest(
                jobId = jobId,
                accountId = accountId,
                serverInstanceId = serverInstanceId,
                draftId = draft.id,
                baseVersionId = null,
                operation = AiOperation.PLAN,
                artifact = buildJsonObject { put("plan", "test") }
            )
        )

        val stored = assertNotNull(fixture.drafts.getVersion(UUID.fromString(artifact.artifactId)))
        assertEquals("orryx/ai/plan-$jobId.json", stored.files.single().path)
    }

    @Test
    fun `restoring snapshot creates a new open draft without mutating snapshot`() = runTest {
        val fixture = fixture()
        val before = fixture.snapshots.get(fixture.snapshotId)
        val restored = fixture.drafts.createDraft(
            CreateDraftCommand(
                accountId = "account-restore",
                serverInstanceId = fixture.serverInstanceId,
                baseSnapshotId = fixture.snapshotId,
                title = "Restore point",
                createdAt = NOW.plusSeconds(10)
            )
        )

        assertEquals(DraftStatus.OPEN, restored.status)
        assertEquals(0, restored.currentVersion)
        assertEquals(fixture.snapshotId, restored.baseSnapshotId)
        assertEquals(before, fixture.snapshots.get(fixture.snapshotId))
    }

    @Test
    fun `postgres repository mappings remain loadable`() {
        assertEquals("PostgresDraftRepository", PostgresDraftRepository::class.simpleName)
        assertEquals("PostgresSnapshotRepository", com.orryx.editor.snapshot.PostgresSnapshotRepository::class.simpleName)
    }

    private suspend fun fixture(
        accountId: String = "account-1",
        serverInstanceId: String = "server-1"
    ): Fixture {
        val clock = Clock.fixed(NOW, ZoneOffset.UTC)
        val snapshotRepository = InMemorySnapshotRepository()
        val snapshots = SnapshotService(snapshotRepository, clock = clock)
        val baseContent = "value: one\n"
        val baseRevision = SnapshotManifest.contentRevision(baseContent)
        val snapshot = snapshots.createSnapshot(
            CreateSnapshotCommand(
                serverInstanceId = serverInstanceId,
                files = listOf(
                    SnapshotFile(
                        "config.yml",
                        baseRevision,
                        baseContent.toByteArray().size.toLong(),
                        baseContent
                    )
                ),
                source = SnapshotSource.PLUGIN,
                createdAt = NOW
            )
        )
        return Fixture(
            snapshots = snapshots,
            drafts = DraftService(InMemoryDraftRepository(), snapshotRepository, clock = clock),
            snapshotId = snapshot.id,
            baseRevision = baseRevision,
            accountId = accountId,
            serverInstanceId = serverInstanceId
        )
    }

    private data class Fixture(
        val snapshots: SnapshotService,
        val drafts: DraftService,
        val snapshotId: UUID,
        val baseRevision: String,
        val accountId: String,
        val serverInstanceId: String
    ) {
        suspend fun createDraft(): Draft = drafts.createDraft(
            CreateDraftCommand(
                accountId = accountId,
                serverInstanceId = serverInstanceId,
                baseSnapshotId = snapshotId,
                title = "Test draft",
                createdAt = NOW
            )
        )

        fun upsert(content: String): DraftFile = DraftFile(
            changeType = DraftFileChangeType.UPSERT,
            path = "config.yml",
            baseRevision = baseRevision,
            contentRevision = SnapshotManifest.contentRevision(content),
            size = content.toByteArray().size.toLong(),
            content = content
        )
    }

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
    }
}
