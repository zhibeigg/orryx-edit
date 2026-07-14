package com.orryx.editor.ai

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class AiJobRepositoryTest {
    private val now = Instant.parse("2026-03-20T00:00:00Z")

    @Test
    fun `idempotent create returns original job and conflicts on changed payload`() = runTest {
        val repository = InMemoryAiJobRepository()
        val original = repository.create(command())
        val repeated = repository.create(command().copy(id = UUID.randomUUID()))
        assertEquals(original.id, repeated.id)

        val failure = assertFailsWith<AiJobException> {
            repository.create(command().copy(id = UUID.randomUUID(), prompt = "different"))
        }
        assertEquals(AiJobErrorCode.IDEMPOTENCY_CONFLICT, failure.code)
    }

    @Test
    fun `state machine requires lease and billing before success`() = runTest {
        val repository = InMemoryAiJobRepository()
        val queued = repository.create(command())
        val lease = repository.claimNext("worker-1", now, Duration.ofMinutes(1))
        assertEquals(queued.id, lease?.job?.id)
        assertEquals(AiJobStatus.RUNNING, lease?.job?.status)
        assertNull(repository.claimNext("worker-2", now.plusSeconds(1), Duration.ofMinutes(1)))

        assertFailsWith<IllegalStateException> {
            repository.succeed(
                queued.id,
                "worker-1",
                buildJsonObject { put("operation", "generate") },
                buildJsonObject { put("ok", true) },
                now.plusSeconds(2)
            )
        }
        repository.recordBilling(
            queued.id,
            "worker-1",
            AiJobBilling(AiProviderUsage(100, 20), 3, null, null),
            now.plusSeconds(3)
        )
        val succeeded = repository.succeed(
            queued.id,
            "worker-1",
            buildJsonObject { put("operation", "generate") },
            buildJsonObject { put("ok", true) },
            now.plusSeconds(4)
        )
        assertEquals(AiJobStatus.SUCCEEDED, succeeded.status)
        assertEquals(3, succeeded.costAmount)
        assertFailsWith<AiJobException> { repository.cancel(queued.id, now.plusSeconds(5)) }
    }

    @Test
    fun `expired running job can be reclaimed`() = runTest {
        val repository = InMemoryAiJobRepository()
        val job = repository.create(command())
        repository.claimNext("worker-1", now, Duration.ofSeconds(5))
        val reclaimed = repository.claimNext("worker-2", now.plusSeconds(6), Duration.ofMinutes(1))
        assertEquals(job.id, reclaimed?.job?.id)
        assertEquals("worker-2", reclaimed?.owner)
    }

    @Test
    fun `fixed rate calculator uses long cents with deterministic ceiling`() {
        val calculator = FixedRateCostCalculator(
            mapOf(
                ProviderModelKey("openai", "model-stable") to ModelTokenPricing(
                    inputCentsPerMillion = 100,
                    outputCentsPerMillion = 300,
                    cachedInputCentsPerMillion = 50
                )
            )
        )
        assertEquals(1, calculator.calculate("openai", "model-stable", AiProviderUsage(1, 0)))
        assertEquals(4, calculator.calculate("openai", "model-stable", AiProviderUsage(10_000, 10_000, 2_000)))
    }

    private fun command() = CreateAiJobCommand(
        accountId = UUID.fromString("10000000-0000-0000-0000-000000000001"),
        serverInstanceId = UUID.fromString("20000000-0000-0000-0000-000000000001"),
        draftId = UUID.fromString("30000000-0000-0000-0000-000000000001"),
        baseVersionId = null,
        operation = AiOperation.GENERATE,
        prompt = "generate a safe draft",
        providerId = "openai",
        model = "model-stable",
        idempotencyKey = "request-1",
        now = now,
        id = UUID.fromString("40000000-0000-0000-0000-000000000001")
    )
}
