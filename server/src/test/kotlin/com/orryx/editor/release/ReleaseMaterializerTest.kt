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
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ReleaseMaterializerTest {
    @Test
    fun `materializer rebuilds full target and preserves base revisions`() = runTest {
        val snapshots = InMemorySnapshotRepository()
        val snapshotService = SnapshotService(snapshots, clock = CLOCK)
        val a0 = "a: 0\n"
        val b0 = "b: 0\n"
        val unchanged0 = "unchanged: true\n"
        val base = snapshotService.createSnapshot(
            CreateSnapshotCommand(
                serverInstanceId = "server-1",
                files = listOf(file("a.yml", a0), file("b.yml", b0), file("unchanged.yml", unchanged0)),
                source = SnapshotSource.PLUGIN,
                createdAt = NOW
            )
        )
        val repository = InMemoryDraftRepository()
        val drafts = DraftService(repository, snapshots, clock = CLOCK)
        val draft = drafts.createDraft(CreateDraftCommand("account-1", "server-1", base.id, "release", createdAt = NOW))
        val a1 = "a: 1\n"
        val c1 = "c: 1\n"
        val versionId = UUID.randomUUID()
        drafts.appendVersion(
            AppendDraftVersionCommand(
                draftId = draft.id,
                expectedCurrentVersion = 0,
                files = listOf(
                    upsert("a.yml", SnapshotManifest.contentRevision(a0), a1),
                    DraftFile(DraftFileChangeType.DELETE, "b.yml", SnapshotManifest.contentRevision(b0), null, 0, null),
                    upsert("c.yml", null, c1)
                ),
                source = DraftVersionSource.MANUAL,
                authorAccountId = "account-1",
                id = versionId,
                createdAt = NOW.plusSeconds(1)
            )
        )

        val target = DraftMaterializer(repository, snapshots).materialize(draft.id, 1)

        assertEquals(listOf("a.yml", "c.yml", "unchanged.yml"), target.files.map { it.path })
        assertEquals(SnapshotManifest.contentRevision(a0), target.files[0].baseRevision)
        assertEquals(SnapshotManifest.contentRevision(a1), target.files[0].revision)
        assertNull(target.files[1].baseRevision)
        assertEquals(SnapshotManifest.contentRevision(c1), target.files[1].revision)
        assertEquals(SnapshotManifest.contentRevision(unchanged0), target.files[2].baseRevision)
        assertEquals(SnapshotManifest.contentRevision(unchanged0), target.files[2].revision)
        assertEquals(unchanged0, target.files[2].content)
        assertEquals(base.manifestRevision, target.baseManifestRevision)
        assertEquals(target.targetManifestRevision, drafts.getVersion(versionId)?.version?.manifestRevision)
    }

    private fun file(path: String, content: String): SnapshotFile =
        SnapshotFile(path, SnapshotManifest.contentRevision(content), content.toByteArray().size.toLong(), content)

    private fun upsert(path: String, baseRevision: String?, content: String): DraftFile = DraftFile(
        DraftFileChangeType.UPSERT,
        path,
        baseRevision,
        SnapshotManifest.contentRevision(content),
        content.toByteArray().size.toLong(),
        content
    )

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
        val CLOCK: Clock = Clock.fixed(NOW, ZoneOffset.UTC)
    }
}
