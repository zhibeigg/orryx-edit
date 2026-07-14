package com.orryx.editor.runner

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KtorRunnerClientTest {
    @Test
    fun `endpoint permits loopback or configured private URI only`() {
        assertEquals("127.0.0.1", validateRunnerEndpoint(URI("http://127.0.0.1:8090/run")).host)
        assertFailsWith<IllegalArgumentException> {
            validateRunnerEndpoint(URI("https://runner.example.com/run"))
        }
        assertEquals(
            "10.20.0.8",
            validateRunnerEndpoint(
                URI("http://10.20.0.8:8090/private/run"),
                setOf(URI("http://10.20.0.8:8090/private"))
            ).host
        )
        assertFailsWith<IllegalArgumentException> {
            validateRunnerEndpoint(
                URI("http://10.20.0.8:8090/other/run"),
                setOf(URI("http://10.20.0.8:8090/private"))
            )
        }
        assertFailsWith<IllegalArgumentException> {
            validateRunnerEndpoint(
                URI("https://runner.example.com/run"),
                setOf(URI("https://runner.example.com"))
            )
        }
    }

    @Test
    fun `secret is validated sent only as bearer and envelope is phase0 safe`() = runBlocking {
        assertFailsWith<IllegalArgumentException> {
            RunnerClientConfig(URI("http://localhost:8090/run"), "short")
        }
        val secret = "runner-shared-secret"
        val engine = MockEngine { request ->
            assertEquals("Bearer $secret", request.headers[HttpHeaders.Authorization])
            assertEquals("runner-request-1", request.headers["X-Request-ID"])
            val body = (request.body as TextContent).text
            assertFalse(body.contains(secret))
            assertTrue(body.contains("\"version\":1"))
            assertTrue(body.contains("\"operation\":\"generate\""))
            respond(
                """{"requestId":"runner-request-1","ok":true,"result":{"files":[]}}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json")
            )
        }
        val client = HttpClient(engine) { followRedirects = false }
        val config = RunnerClientConfig(URI("http://localhost:8090/run"), secret)
        try {
            val result = KtorRunnerClient(client, config).execute(
                RunnerRequest(
                    "runner-request-1",
                    RunnerOperation.GENERATE,
                    buildJsonObject { put("draft", buildJsonObject { put("title", "safe") }) }
                )
            )
            assertEquals("runner-request-1", result.requestId)
            assertFalse(config.toString().contains(secret))
        } finally {
            client.close()
        }
    }

    @Test
    fun `recursive guard blocks privileged fields and unsafe values`() {
        val unsafePayloads = listOf(
            buildJsonObject { put("nested", buildJsonObject { put("materialize", true) }) },
            buildJsonObject { put("items", buildJsonArray { add(buildJsonObject { put("actionsSchemaPath", "/tmp/a") }) }) },
            buildJsonObject { put("network", "allow") },
            buildJsonObject { put("strict", false) },
            buildJsonObject { put("action", "file.write") },
            buildJsonObject { put("reloadServer", true) },
            buildJsonObject { put("workspace", "server") }
        )
        unsafePayloads.forEach { payload ->
            val failure = assertFailsWith<RunnerException> { RunnerPayloadGuard.requireSafe(payload) }
            assertEquals("RUNNER_UNSAFE_PAYLOAD", failure.error.code)
        }
    }

    @Test
    fun `response body is capped`() = runBlocking {
        val client = HttpClient(MockEngine {
            respond("x".repeat(256), HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        })
        try {
            val failure = assertFailsWith<RunnerException> {
                KtorRunnerClient(
                    client,
                    RunnerClientConfig(
                        URI("http://localhost:8090/run"),
                        "runner-shared-secret",
                        maxResponseBytes = 64
                    )
                ).execute(RunnerRequest("request", RunnerOperation.PLAN, buildJsonObject { put("draft", "safe") }))
            }
            assertEquals("RUNNER_RESPONSE_TOO_LARGE", failure.error.code)
        } finally {
            client.close()
        }
    }
}
