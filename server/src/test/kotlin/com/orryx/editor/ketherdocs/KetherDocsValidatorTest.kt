package com.orryx.editor.ketherdocs

import com.orryx.editor.database.sha256
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class KetherDocsValidatorTest {
    private val config = KetherDocsConfig.fromEnvironment(emptyMap())
    private val validator = KetherDocsValidator(config)

    @Test
    fun `accepts official stable pointer manifest and verified schema`() {
        val schema = validSchemaBytes()
        val channel = validator.parseChannel(
            """
            {
              "formatVersion": 1,
              "channel": "stable",
              "releaseId": "$TEST_RELEASE_ID",
              "pluginVersion": "$TEST_PLUGIN_VERSION",
              "commit": "$TEST_COMMIT",
              "publishedAt": "2026-03-20T00:00:00Z",
              "releaseManifest": "/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/manifest.json"
            }
            """.trimIndent().toByteArray()
        )
        val manifestUri = validator.resolveManifestUri(channel)
        val manifest = validator.parseReleaseManifest(
            """
            {
              "formatVersion": 1,
              "releaseId": "$TEST_RELEASE_ID",
              "channel": "stable",
              "plugin": { "id": "Orryx", "version": "$TEST_PLUGIN_VERSION", "commit": "$TEST_COMMIT" },
              "schemaVersion": 3,
              "generatedAt": "2026-03-20T00:00:00Z",
              "previousReleaseId": null,
              "assets": {
                "schema": {
                  "path": "actions-schema.json",
                  "mediaType": "application/json",
                  "bytes": ${schema.size},
                  "sha256": "${sha256(schema)}"
                }
              }
            }
            """.trimIndent().toByteArray(),
            channel
        )
        assertEquals(
            "/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/actions-schema.json",
            validator.resolveSchemaUri(manifestUri, manifest).path
        )
        val fetched = validator.validateRemoteSchema(schema, channel, manifest)
        assertEquals(TEST_RELEASE_ID, fetched.releaseId)
        assertEquals(3, fetched.schemaVersion)
        assertEquals(channel.publishedAt, fetched.publishedAt)
    }

    @Test
    fun `accepts tracked bundled schema without release timestamp`() {
        val bytes = Files.readAllBytes(Path.of("..", "schemas", "actions-schema.json"))
        val bundled = validator.validateBundled(bytes)

        assertEquals(KetherDocsSource.BUNDLED, bundled.source)
        assertEquals(null, bundled.publishedAt)
    }

    @Test
    fun `rejects off-origin manifest and checksum mismatch`() {
        val channelBytes = """
            {
              "formatVersion": 1,
              "channel": "stable",
              "releaseId": "$TEST_RELEASE_ID",
              "pluginVersion": "$TEST_PLUGIN_VERSION",
              "commit": "$TEST_COMMIT",
              "publishedAt": "2026-03-20T00:00:00Z",
              "releaseManifest": "https://evil.example/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/manifest.json"
            }
        """.trimIndent().toByteArray()
        val pointer = validator.parseChannel(channelBytes)
        val urlFailure = assertFailsWith<KetherDocsFailure> { validator.resolveManifestUri(pointer) }
        assertEquals(KetherDocsErrorCode.URL_REJECTED, urlFailure.code)

        val schema = validSchemaBytes()
        val manifest = KetherReleaseManifest(
            releaseId = TEST_RELEASE_ID,
            pluginVersion = TEST_PLUGIN_VERSION,
            commit = TEST_COMMIT,
            schemaVersion = 3,
            generatedAt = Instant.parse("2026-03-20T00:00:00Z"),
            previousReleaseId = null,
            schema = KetherAsset("actions-schema.json", "application/json", schema.size.toLong(), "0".repeat(64))
        )
        val checksumFailure = assertFailsWith<KetherDocsFailure> {
            validator.validateRemoteSchema(schema, pointer.copy(releaseManifest = "/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/manifest.json"), manifest)
        }
        assertEquals(KetherDocsErrorCode.SCHEMA_CHECKSUM_INVALID, checksumFailure.code)
    }
}
