package com.orryx.editor.ai

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class AiProviderCatalogTest {
    @Test
    fun `admin update hot applies enabled models default and pricing without secrets`() = runTest {
        val entry = AiProviderCatalogEntry(
            providerId = "openai",
            providerType = "OPENAI_COMPATIBLE",
            displayName = "OpenAI",
            baseUrl = "https://api.example.test/v1",
            defaultModel = "model-a",
            enabled = true,
            models = listOf(AiProviderModel("model-a", 10, 20)),
            createdAt = NOW,
            updatedAt = NOW
        )
        val registry = AiProviderRegistry(listOf(TestProvider))
        val service = AiProviderCatalogService(InMemoryAiProviderCatalogRepository(listOf(entry)), registry)
        service.initialize()
        assertEquals("model-a", registry.resolve("openai").model)

        val updated = service.update(
            "openai",
            UpdateAiProviderCatalogCommand(
                enabled = true,
                displayName = "Primary AI",
                defaultModel = "model-b",
                models = listOf(AiProviderModel("model-b", 30, 40)),
                requestedBaseUrl = "https://restart.example.test/v1",
                now = NOW.plusSeconds(1)
            )
        )
        assertEquals(true, updated?.restartRequired)
        assertEquals("model-b", registry.resolve("openai").model)
        assertEquals(30, registry.pricing("openai", "model-b")?.inputCentsPerMillion)
        assertFailsWith<AiProviderException> { registry.resolve("openai", "model-a") }
        assertFalse(service.listAdmin().toString().contains("secret-api-key"))
    }

    private object TestProvider : AiProvider {
        override val providerId: String = "openai"
        override suspend fun execute(request: AiProviderRequest): AiProviderResult =
            AiProviderResult(JsonNull, AiProviderUsage(0, 0))
    }

    private companion object {
        val NOW: Instant = Instant.parse("2026-03-20T00:00:00Z")
    }
}
