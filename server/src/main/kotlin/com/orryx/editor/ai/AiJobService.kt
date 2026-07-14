package com.orryx.editor.ai

import com.orryx.editor.runner.RunnerClient
import com.orryx.editor.runner.RunnerException
import com.orryx.editor.runner.RunnerOperation
import com.orryx.editor.runner.RunnerRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

interface AiAccessPolicy {
    suspend fun authorize(request: AiAccessRequest): AiAccessReservation
    suspend fun capture(reservation: AiAccessReservation, usage: AiProviderUsage, costAmount: Long, now: Instant)
    suspend fun release(reservation: AiAccessReservation, reasonCode: String, now: Instant)
}

data class AiAccessRequest(
    val jobId: UUID,
    val accountId: UUID,
    val serverInstanceId: UUID,
    val providerId: String,
    val model: String,
    val operation: AiOperation,
    val idempotencyKey: String
)

data class AiAccessReservation(val reservationId: String) {
    init {
        require(reservationId.isNotBlank()) { "reservationId 不能为空" }
    }
}

class AiAccessException(val errorCode: String) : RuntimeException(errorCode)

interface DraftArtifactSink {
    suspend fun store(request: DraftArtifactRequest): DraftArtifactResult
}

data class DraftArtifactRequest(
    val jobId: UUID,
    val accountId: UUID,
    val serverInstanceId: UUID,
    val draftId: UUID?,
    val baseVersionId: UUID?,
    val operation: AiOperation,
    val artifact: JsonElement
)

data class DraftArtifactResult(val artifactId: String) {
    init {
        require(artifactId.isNotBlank()) { "artifactId 不能为空" }
    }
}

class DraftArtifactException(val errorCode: String = AiJobErrorCode.ARTIFACT_FAILED) : RuntimeException(errorCode)

class AiJobService(
    private val repository: AiJobRepository,
    private val providerRegistry: AiProviderRegistry,
    private val runnerClient: RunnerClient,
    private val accessPolicy: AiAccessPolicy,
    private val artifactSink: DraftArtifactSink,
    private val costCalculator: CostCalculator,
    private val leaseDuration: Duration = Duration.ofMinutes(2),
    private val clock: Clock = Clock.systemUTC()
) {
    init {
        require(!leaseDuration.isNegative && !leaseDuration.isZero) { "leaseDuration 必须大于 0" }
    }

    suspend fun submit(command: CreateAiJobCommand): AiJob {
        val resolved = providerRegistry.resolve(command.providerId, command.model)
        return repository.create(command.copy(providerId = resolved.providerId, model = resolved.model))
    }

    suspend fun processNext(workerId: String): AiJob? {
        val lease = repository.claimNext(workerId, clock.instant(), leaseDuration) ?: return null
        val job = lease.job
        var reservation: AiAccessReservation? = null
        try {
            reservation = accessPolicy.authorize(job.toAccessRequest())
            val resolved = providerRegistry.resolve(job.providerId, job.model)
            val providerResult = resolved.provider.execute(
                AiProviderRequest(
                    requestId = job.id.toString(),
                    model = resolved.model,
                    operation = job.operation,
                    prompt = job.prompt
                )
            )
            val runnerResult = runnerClient.execute(
                RunnerRequest(
                    requestId = job.id.toString(),
                    operation = job.operation.toRunnerOperation(),
                    payload = providerResult.content
                )
            )
            artifactSink.store(
                DraftArtifactRequest(
                    jobId = job.id,
                    accountId = job.accountId,
                    serverInstanceId = job.serverInstanceId,
                    draftId = job.draftId,
                    baseVersionId = job.baseVersionId,
                    operation = job.operation,
                    artifact = runnerResult.result
                )
            )
            val costAmount = costCalculator.calculate(job.providerId, job.model, providerResult.usage)
            repository.recordBilling(
                job.id,
                workerId,
                AiJobBilling(
                    usage = providerResult.usage,
                    costAmount = costAmount,
                    providerRequest = providerResult.requestPayload,
                    providerResponse = providerResult.responsePayload
                ),
                clock.instant()
            )
            accessPolicy.capture(reservation, providerResult.usage, costAmount, clock.instant())
            return repository.succeed(
                job.id,
                workerId,
                runnerResult.requestEnvelope,
                runnerResult.responseEnvelope,
                clock.instant()
            )
        } catch (failure: CancellationException) {
            withContext(NonCancellable) {
                reservation?.let { reserved ->
                    try {
                        accessPolicy.release(reserved, "AI_JOB_WORKER_CANCELED", clock.instant())
                    } catch (releaseFailure: Throwable) {
                        failure.addSuppressed(releaseFailure)
                    }
                }
                try {
                    repository.requeue(job.id, workerId, clock.instant())
                } catch (requeueFailure: Throwable) {
                    failure.addSuppressed(requeueFailure)
                }
            }
            throw failure
        } catch (failure: Throwable) {
            val classified = classifyFailure(failure)
            reservation?.let { reserved ->
                try {
                    accessPolicy.release(reserved, classified.first, clock.instant())
                } catch (releaseFailure: Throwable) {
                    failure.addSuppressed(releaseFailure)
                }
            }
            return try {
                repository.fail(job.id, workerId, classified.first, classified.second, clock.instant())
            } catch (stateFailure: AiJobException) {
                if (stateFailure.code == AiJobErrorCode.INVALID_STATE) repository.find(job.id) else throw stateFailure
            }
        }
    }

    suspend fun cancel(jobId: UUID): AiJob? = repository.cancel(jobId, clock.instant())

    private fun classifyFailure(failure: Throwable): Pair<String, String?> = when (failure) {
        is AiAccessException -> failure.errorCode to null
        is AiProviderException -> failure.error.code to failure.error.message?.take(MAX_ERROR_MESSAGE)
        is RunnerException -> failure.error.code to failure.error.message?.take(MAX_ERROR_MESSAGE)
        is DraftArtifactException -> failure.errorCode to null
        is AiJobException -> failure.code to failure.message?.take(MAX_ERROR_MESSAGE)
        else -> AiJobErrorCode.INTERNAL to null
    }

    private companion object {
        const val MAX_ERROR_MESSAGE = 1_000
    }
}

class AiJobWorker(
    private val scope: CoroutineScope,
    private val service: AiJobService,
    private val workerId: String,
    private val idleDelay: Duration = Duration.ofSeconds(1)
) {
    init {
        require(workerId.isNotBlank() && workerId.length <= 128) { "workerId 无效" }
        require(!idleDelay.isNegative && !idleDelay.isZero) { "idleDelay 必须大于 0" }
    }

    fun start() = scope.launch {
        while (isActive) {
            val processed = service.processNext(workerId)
            if (processed == null) delay(idleDelay.toMillis())
        }
    }
}

private fun AiJob.toAccessRequest(): AiAccessRequest = AiAccessRequest(
    jobId = id,
    accountId = accountId,
    serverInstanceId = serverInstanceId,
    providerId = providerId,
    model = model,
    operation = operation,
    idempotencyKey = idempotencyKey
)

private fun AiOperation.toRunnerOperation(): RunnerOperation = when (this) {
    AiOperation.GENERATE -> RunnerOperation.GENERATE
    AiOperation.VALIDATE -> RunnerOperation.VALIDATE
    AiOperation.PLAN -> RunnerOperation.PLAN
}
