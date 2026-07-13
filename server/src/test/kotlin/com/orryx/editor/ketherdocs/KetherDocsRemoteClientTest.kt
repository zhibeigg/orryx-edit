package com.orryx.editor.ketherdocs

import com.orryx.editor.database.sha256
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class KetherDocsRemoteClientTest {
    @Test
    fun `downloads official immutable release and validates every hop`() = runTest {
        val schema = validSchemaBytes()
        val engine = MockEngine { request ->
            val body = when (request.url.encodedPath) {
                "/Orryx/kether/channels/stable.json" -> channelJson()
                "/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/manifest.json" -> manifestJson(schema)
                "/Orryx/kether/releases/$TEST_PLUGIN_VERSION/$TEST_COMMIT/actions-schema.json" -> schema
                else -> error("unexpected URL: ${request.url}")
            }
            respond(
                content = body,
                status = HttpStatusCode.OK,
                headers = headersOf(
                    HttpHeaders.ContentType to listOf("application/json"),
                    HttpHeaders.ContentLength to listOf(body.size.toString())
                )
            )
        }
        val client = HttpClient(engine) { followRedirects = false }
        val config = KetherDocsConfig.fromEnvironment(emptyMap())
        try {
            val fetched = withContext(Dispatchers.Default) {
                KetherDocsRemoteClient(client, config, KetherDocsValidator(config)).fetchLatest()
            }
            assertEquals(TEST_RELEASE_ID, fetched.releaseId)
            assertEquals(sha256(schema), fetched.schemaSha256)
        } finally {
            client.close()
        }
    }

    @Test
    fun `rejects redirects instead of following untrusted location`() = runTest {
        val client = HttpClient(MockEngine {
            respond(
                content = ByteArray(0),
                status = HttpStatusCode.Found,
                headers = headersOf(HttpHeaders.Location, "https://evil.example/schema.json")
            )
        }) { followRedirects = false }
        val config = KetherDocsConfig.fromEnvironment(emptyMap())
        try {
            val failure = assertFailsWith<KetherDocsFailure> {
                withContext(Dispatchers.Default) {
                    KetherDocsRemoteClient(client, config, KetherDocsValidator(config)).fetchLatest()
                }
            }
            assertEquals(KetherDocsErrorCode.URL_REJECTED, failure.code)
        } finally {
            client.close()
        }
    }

    private fun channelJson(): ByteArray = """
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

    private fun manifestJson(schema: ByteArray): ByteArray = """
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
    """.trimIndent().toByteArray()
}
