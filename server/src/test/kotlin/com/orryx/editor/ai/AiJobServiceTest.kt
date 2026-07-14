package com.orryx.editor.ai

import com.orryx.editor.runner.RunnerClient
import com.orryx.editor.runner.RunnerRequest
import com.orryx.editor.runner.RunnerResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class AiJobServiceTest {
    private val now = Instant.parse("2026-03-20T00:00:00Z")

    @Test
    fun `successful worker captures cost and writes only through draft artifact sink`() = runTest {
        val repository = InMemoryAiJobRepository()
        val provider = StubProvider()
        val runner = StubRunner()
        val access = RecordingAccessPolicy()
        val sink = RecordingArtifactSink()
        val service = service(repository, provider, runner, access, sink)
        val submitted = service.submit(command("success-1"))

        val completed = service.processNext("worker-1")

        assertEquals(submitted.id, completed?.id)
        assertEquals(AiJobStatus.SUCCEEDED, completed?.status)
        assertEquals(1, provider.calls)
        assertEquals(1, runner.calls)
        assertEquals(1, sink.calls)
        assertEquals(submitted.draftId, sink.lastRequest?.draftId)
        assertEquals(1, access.authorized)
        assertEquals(1, access.captured)
        assertEquals(0, access.released)
        assertEquals(1, completed?.costAmount)
        assertNotNull(completed?.runnerRequest)
        assertNotNull(completed?.runnerResult)
    }

    @Test
    fun `provider failure releases reservation and never writes artifact`() = runTest {
        val repository = InMemoryAiJobRepository()
        val provider = StubProvider(failure = AiProviderException(
            AiProviderError(AiProviderErrorCategory.RATE_LIMIT, "AI_PROVIDER_RATE_LIMIT", true)
        ))
        val runner = StubRunner()
        val access = RecordingAccessPolicy()
        val sink = RecordingArtifactSink()
        val service = service(repository, provider, runner, access, sink)
        service.submit(command("failure-1"))

        val failed = service.processNext("worker-1")

        assertEquals(AiJobStatus.FAILED, failed?.status)
        assertEquals("AI_PROVIDER_RATE_LIMIT", failed?.errorCode)
        assertEquals(1, access.authorized)
        assertEquals(0, access.captured)
        assertEquals(1, access.released)
        assertEquals(0, runner.calls)
        assertEquals(0, sink.calls)
    }

    @Test
    fun `disabled provider is rejected before job persistence`() = runTest {
        val repository = InMemoryAiJobRepository()
        val provider = StubProvider()
        val registry = AiProviderRegistry(
            listOf(provider),
            listOf(AiProviderRegistration("openai", false, setOf("model-stable"), "model-stable"))
        )
        val service = AiJobService(
            repository,
            registry,
            StubRunner(),
            RecordingAccessPolicy(),
            RecordingArtifactSink(),
            pricing(),
            clock = Clock.fixed(now, ZoneOffset.UTC)
        )

        val failure = kotlin.test.assertFailsWith<AiProviderException> { service.submit(command("disabled-1")) }
        assertEquals(AiProviderErrorCategory.DISABLED, failure.error.category)
        assertEquals(null, repository.findByIdempotency(command("disabled-1").accountId, "disabled-1"))
    }

    private fun service(
        repository: AiJobRepository,
        provider: AiProvider,
        runner: RunnerClient,
        access: AiAccessPolicy,
        sink: DraftArtifactSink
    ): AiJobService = AiJobService(
        repository = repository,
        providerRegistry = AiProviderRegistry(
            listOf(provider),
            listOf(AiProviderRegistration("openai", true, setOf("model-stable"), "model-stable"))
        ),
        runnerClient = runner,
        accessPolicy = access,
        artifactSink = sink,
        costCalculator = pricing(),
        clock = Clock.fixed(now, ZoneOffset.UTC)
    )

    private fun pricing() = FixedRateCostCalculator(
        mapOf(ProviderModelKey("openai", "model-stable") to ModelTokenPricing(100, 300))
    )

    private fun command(idempotencyKey: String) = CreateAiJobCommand(
        accountId = UUID.fromString("10000000-0000-0000-0000-000000000001"),
        serverInstanceId = UUID.fromString("20000000-0000-0000-0000-000000000001"),
        draftId = UUID.fromString("30000000-0000-0000-0000-000000000001"),
        baseVersionId = null,
        operation = AiOperation.GENERATE,
        prompt = "generate a safe draft",
        providerId = "openai",
        model = "model-stable",
        idempotencyKey = idempotencyKey,
        now = now
    )
}

private class StubProvider(private val failure: Throwable? = null) : AiProvider {
    override val providerId: String = "openai"
    var calls: Int = 0

    override suspend fun execute(request: AiProviderRequest): AiProviderResult {
        calls++
        failure?.let { throw it }
        return AiProviderResult(
            content = buildJsonObject { put("files", kotlinx.serialization.json.buildJsonArray { }) },
            usage = AiProviderUsage(100, 20),
            providerRequestId = "provider-request",
            requestPayload = buildJsonObject { put("model", request.model) },
            responsePayload = buildJsonObject { put("id", "provider-request") }
        )
    }
}

private class StubRunner : RunnerClient {
    var calls: Int = 0

    override suspend fun execute(request: RunnerRequest): RunnerResult {
        calls++
        val requestEnvelope = buildJsonObject {
            put("requestId", request.requestId)
            put("operation", "generate")
            put("payload", request.payload)
        }
        val responseEnvelope = buildJsonObject {
            put("requestId", request.requestId)
            put("ok", true)
            put("result", buildJsonObject { put("files", kotlinx.serialization.json.buildJsonArray { }) })
        }
        return RunnerResult(
            request.requestId,
            responseEnvelope.getValue("result"),
            requestEnvelope,
            responseEnvelope
        )
    }
}

private class RecordingAccessPolicy : AiAccessPolicy {
    var authorized: Int = 0
    var captured: Int = 0
    var released: Int = 0

    override suspend fun authorize(request: AiAccessRequest): AiAccessReservation {
        authorized++
        return AiAccessReservation("reservation-${request.jobId}")
    }

    override suspend fun capture(
        reservation: AiAccessReservation,
        usage: AiProviderUsage,
        costAmount: Long,
        now: Instant
    ) {
        captured++
    }

    override suspend fun release(reservation: AiAccessReservation, reasonCode: String, now: Instant) {
        released++
    }
}

private class RecordingArtifactSink : DraftArtifactSink {
    var calls: Int = 0
    var lastRequest: DraftArtifactRequest? = null

    override suspend fun store(request: DraftArtifactRequest): DraftArtifactResult {
        calls++
        lastRequest = request
        return DraftArtifactResult("artifact-${request.jobId}")
    }
}
