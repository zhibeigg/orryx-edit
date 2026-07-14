package com.orryx.editor.snapshot

import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SnapshotManifestTest {
    @Test
    fun `canonical hash matches phase one path size revision field order`() {
        val files = listOf(
            SnapshotFile("z.yml", "b".repeat(64), 5, null),
            SnapshotFile("a.yml", "a".repeat(64), 3, null)
        )

        assertEquals(
            "33c30f5f5e6ae4f27dc46088e31f373f3f599ddb2c7f8d5cdeb3da42b90ed751",
            SnapshotManifest.canonicalRevision(files)
        )
        assertEquals(SnapshotManifest.canonicalRevision(files), SnapshotManifest.canonicalRevision(files.reversed()))
    }

    @Test
    fun `rejects duplicate paths that differ only by case`() {
        assertFailsWith<IllegalArgumentException> {
            SnapshotManifest.validateFiles(
                listOf(
                    SnapshotFile("Skills/Test.yml", "a".repeat(64), 0, null),
                    SnapshotFile("skills/test.yml", "b".repeat(64), 0, null)
                )
            )
        }
    }

    @Test
    fun `rejects traversal absolute drive and unsafe components`() {
        listOf("../secret.yml", "/secret.yml", "C:/secret.yml", "skills//test.yml", "skills/.editor")
            .forEach { path ->
                assertFailsWith<IllegalArgumentException>(path) { SnapshotManifest.validatePath(path) }
            }
    }

    @Test
    fun `validates utf8 content size and sha`() {
        val content = "你好"
        val revision = SnapshotManifest.contentRevision(content)
        SnapshotManifest.validateFiles(
            listOf(SnapshotFile("messages.yml", revision, content.toByteArray().size.toLong(), content))
        )

        assertFailsWith<IllegalArgumentException> {
            SnapshotManifest.validateFiles(listOf(SnapshotFile("messages.yml", revision, 2, content)))
        }
        assertFailsWith<IllegalArgumentException> {
            SnapshotManifest.validateFiles(
                listOf(SnapshotFile("messages.yml", "0".repeat(64), content.toByteArray().size.toLong(), content))
            )
        }
    }

    @Test
    fun `in memory snapshot creation is idempotent by server and manifest`() = runTest {
        val repository = InMemorySnapshotRepository()
        val service = SnapshotService(repository, clock = Clock.fixed(NOW, ZoneOffset.UTC))
        val content = "value: true\n"
        val file = SnapshotFile(
            path = "config.yml",
            revision = SnapshotManifest.contentRevision(content),
            size = content.toByteArray().size.toLong(),
            content = content
        )
        val first = service.createSnapshot(
            CreateSnapshotCommand("server-1", listOf(file), SnapshotSource.PLUGIN, id = UUID.randomUUID())
        )
        val replay = service.createSnapshot(
            CreateSnapshotCommand("server-1", listOf(file), SnapshotSource.PLUGIN, id = UUID.randomUUID())
        )

        assertEquals(first, replay)
        assertEquals(1, service.list().size)
    }

    private companion object {
        val NOW: Instant = Instant.parse("2025-06-01T00:00:00Z")
    }
}
