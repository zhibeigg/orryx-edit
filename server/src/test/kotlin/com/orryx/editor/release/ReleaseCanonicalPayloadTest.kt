package com.orryx.editor.release

import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class ReleaseCanonicalPayloadTest {
    @Test
    fun `canonical payload matches golden binary vector and path order`() {
        val input = ReleaseCanonicalPayload.Input(
            keyId = "key-1",
            releaseId = "release-1",
            serverInstanceId = "server-instance-1",
            stableServerId = "stable-server-1",
            draftId = "draft-1",
            draftVersionId = "draft-version-1",
            expectedBaseManifestRevision = "a".repeat(64),
            targetManifestRevision = "b".repeat(64),
            createdAtEpochMillis = 1_748_736_000_123,
            files = listOf(
                ReleaseCanonicalPayload.File("z.yml", null, "c".repeat(64), 7),
                ReleaseCanonicalPayload.File("a.yml", "d".repeat(64), "e".repeat(64), 3)
            )
        )

        val encoded = ReleaseCanonicalPayload.encode(input)
        val expectedHex = "4f525259582d52454c454153450001000000056b65792d310000000972656c656173652d31000000117365727665722d696e7374616e63652d310000000f737461626c652d7365727665722d310000000764726166742d310000000f64726166742d76657273696f6e2d31000000406161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616100000040626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262620000019728c9c07b0000000200000005612e796d6c01ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000003000000057a2e796d6c00cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0000000000000007"
        assertEquals(expectedHex, encoded.toHex())
        assertEquals("d313e0474d670a4f53c5394d07440e46d9f8dc77fc8c57f5a397f7f3cf66ab6d", sha256(encoded))
        assertContentEquals(encoded, ReleaseCanonicalPayload.encode(input.copy(files = input.files.reversed())))
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()
}
