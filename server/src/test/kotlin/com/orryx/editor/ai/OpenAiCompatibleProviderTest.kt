package com.orryx.editor.ai

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class OpenAiCompatibleProviderTest {
    @Test
    fun `base URL only permits https or explicit loopback http`() {
        assertEquals("https", validateAiProviderBaseUrl("https://api.example.com/v1").scheme)
        assertEquals("http", validateAiProviderBaseUrl("http://127.0.0.1:11434/v1").scheme)
        assertFailsWith<IllegalArgumentException> { validateAiProviderBaseUrl("http://api.example.com/v1") }
        assertFailsWith<IllegalArgumentException> { validateAiProviderBaseUrl("https://user@example.com/v1") }
    }

    @Test
    fun `parses structured JSON usage and never serializes API key`() = runBlocking {
        val secret = "provider-secret-value"
        val engine = MockEngine { request ->
            assertEquals("Bearer $secret", request.headers[HttpHeaders.Authorization])
            assertEquals("request-1", request.headers["X-Request-ID"])
            assertFalse(request.url.toString().contains(secret))
            val requestBody = (request.body as TextContent).text
            assertFalse(requestBody.contains(secret))
            respond(
                content = """
                    {
                      "id":"upstream-1",
                      "choices":[{"message":{"content":"{\"files\":[{\"path\":\"skills/a.yml\",\"content\":\"x\"}]}"}}],
                      "usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":20}}
                    }
                """.trimIndent(),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }
        val client = HttpClient(engine) { followRedirects = false }
        val config = OpenAiProviderConfig("openai", URI("https://api.example.com/v1"), secret)
        try {
            val result = OpenAiCompatibleProvider(client, config).execute(
                AiProviderRequest("request-1", "model-stable", AiOperation.GENERATE, "generate a draft")
            )
            assertEquals("upstream-1", result.providerRequestId)
            assertEquals(120, result.usage.inputTokens)
            assertEquals(30, result.usage.outputTokens)
            assertEquals(20, result.usage.cachedInputTokens)
            assertEquals("skills/a.yml", result.content.toString().substringAfter("\"path\":\"").substringBefore('"'))
            assertFalse(config.toString().contains(secret))
            assertFalse(result.requestPayload.toString().contains(secret))
        } finally {
            client.close()
        }
    }

    @Test
    fun `rejects non JSON assistant content`() = runBlocking {
        val client = HttpClient(MockEngine {
            respond(
                """{"choices":[{"message":{"content":"plain text"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}""",
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentType, "application/json")
            )
        })
        try {
            val failure = assertFailsWith<AiProviderException> {
                OpenAiCompatibleProvider(
                    client,
                    OpenAiProviderConfig("openai", URI("https://api.example.com/v1"), "provider-secret-value")
                ).execute(AiProviderRequest("request-2", "model-stable", AiOperation.PLAN, "plan"))
            }
            assertEquals(AiProviderErrorCategory.INVALID_RESPONSE, failure.error.category)
        } finally {
            client.close()
        }
    }
}
