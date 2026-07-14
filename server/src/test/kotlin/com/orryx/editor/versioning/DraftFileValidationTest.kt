package com.orryx.editor.versioning

import com.orryx.editor.snapshot.SnapshotManifest
import kotlin.test.Test
import kotlin.test.assertFailsWith

class DraftFileValidationTest {
    @Test
    fun `upsert content must match revision and size`() {
        val content = "key: value\n"
        DraftFileValidation.validate(
            listOf(
                DraftFile(
                    DraftFileChangeType.UPSERT,
                    "config.yml",
                    null,
                    SnapshotManifest.contentRevision(content),
                    content.toByteArray().size.toLong(),
                    content
                )
            )
        )

        assertFailsWith<IllegalArgumentException> {
            DraftFileValidation.validate(
                listOf(
                    DraftFile(
                        DraftFileChangeType.UPSERT,
                        "config.yml",
                        null,
                        "0".repeat(64),
                        content.toByteArray().size.toLong(),
                        content
                    )
                )
            )
        }
    }

    @Test
    fun `delete forbids content revision and content`() {
        assertFailsWith<IllegalArgumentException> {
            DraftFileValidation.validate(
                listOf(
                    DraftFile(
                        DraftFileChangeType.DELETE,
                        "config.yml",
                        "a".repeat(64),
                        "b".repeat(64),
                        0,
                        "forbidden"
                    )
                )
            )
        }
    }
}
