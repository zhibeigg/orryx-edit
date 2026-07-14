package com.orryx.editor.ai

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Duration
import java.time.Instant
import java.util.UUID

class InMemoryAiJobRepository : AiJobRepository {
    private val mutex = Mutex()
    private val jobs = linkedMapOf<UUID, AiJob>()

    override suspend fun create(command: CreateAiJobCommand): AiJob {
        validateCreateAiJobCommand(command)
        return mutex.withLock {
            val existing = jobs.values.firstOrNull {
                it.accountId == command.accountId && it.idempotencyKey == command.idempotencyKey
            }
            if (existing != null) {
                if (!existing.sameIdempotentRequest(command)) throw AiJobException(AiJobErrorCode.IDEMPOTENCY_CONFLICT)
                return@withLock existing
            }
            AiJob(
                id = command.id,
                accountId = command.accountId,
                serverInstanceId = command.serverInstanceId,
                draftId = command.draftId,
                baseVersionId = command.baseVersionId,
                status = AiJobStatus.QUEUED,
                operation = command.operation,
                prompt = command.prompt,
                providerId = command.providerId,
                model = command.model,
                idempotencyKey = command.idempotencyKey,
                createdAt = command.now,
                updatedAt = command.now
            ).also { jobs[it.id] = it }
        }
    }

    override suspend fun find(id: UUID): AiJob? = mutex.withLock { jobs[id] }

    override suspend fun findByIdempotency(accountId: UUID, idempotencyKey: String): AiJob? = mutex.withLock {
        jobs.values.firstOrNull { it.accountId == accountId && it.idempotencyKey == idempotencyKey }
    }

    override suspend fun claimNext(owner: String, now: Instant, leaseDuration: Duration): AiJobLease? {
        require(owner.isNotBlank() && owner.length <= 128) { "lease owner 无效" }
        require(!leaseDuration.isNegative && !leaseDuration.isZero) { "leaseDuration 必须大于 0" }
        return mutex.withLock {
            val current = jobs.values
                .asSequence()
                .filter { job ->
                    job.status == AiJobStatus.QUEUED ||
                        (job.status == AiJobStatus.RUNNING && job.leaseExpiresAt?.let { !it.isAfter(now) } == true)
                }
                .minWithOrNull(compareBy<AiJob> { it.createdAt }.thenBy { it.id })
                ?: return@withLock null
            val expiresAt = now.plus(leaseDuration)
            val claimed = current.copy(
                status = AiJobStatus.RUNNING,
                leaseOwner = owner,
                leaseExpiresAt = expiresAt,
                updatedAt = now,
                startedAt = current.startedAt ?: now,
                finishedAt = null,
                errorCode = null,
                errorMessage = null
            )
            jobs[current.id] = claimed
            AiJobLease(claimed, owner, expiresAt)
        }
    }

    override suspend fun recordBilling(
        jobId: UUID,
        owner: String,
        billing: AiJobBilling,
        now: Instant
    ): AiJob = updateRunning(jobId, owner, now) { current ->
        current.copy(
            providerRequest = billing.providerRequest,
            providerResponse = billing.providerResponse,
            usage = billing.usage,
            costAmount = billing.costAmount,
            updatedAt = now
        )
    }

    override suspend fun succeed(
        jobId: UUID,
        owner: String,
        runnerRequest: kotlinx.serialization.json.JsonElement,
        runnerResult: kotlinx.serialization.json.JsonElement,
        now: Instant
    ): AiJob = updateRunning(jobId, owner, now) { current ->
        check(current.usage != null && current.costAmount != null) { "成功前必须记录 usage/cost" }
        current.copy(
            status = AiJobStatus.SUCCEEDED,
            leaseOwner = null,
            leaseExpiresAt = null,
            runnerRequest = runnerRequest,
            runnerResult = runnerResult,
            updatedAt = now,
            finishedAt = now
        )
    }

    override suspend fun fail(
        jobId: UUID,
        owner: String,
        errorCode: String,
        errorMessage: String?,
        now: Instant
    ): AiJob = updateRunning(jobId, owner, now) { current ->
        current.copy(
            status = AiJobStatus.FAILED,
            leaseOwner = null,
            leaseExpiresAt = null,
            errorCode = errorCode,
            errorMessage = errorMessage,
            updatedAt = now,
            finishedAt = now
        )
    }

    override suspend fun requeue(jobId: UUID, owner: String, now: Instant): AiJob = updateRunning(jobId, owner, now) { current ->
        current.copy(
            status = AiJobStatus.QUEUED,
            leaseOwner = null,
            leaseExpiresAt = null,
            updatedAt = now,
            finishedAt = null
        )
    }

    override suspend fun cancel(jobId: UUID, now: Instant): AiJob? = mutex.withLock {
        val current = jobs[jobId] ?: return@withLock null
        when (current.status) {
            AiJobStatus.QUEUED, AiJobStatus.RUNNING -> current.copy(
                status = AiJobStatus.CANCELED,
                leaseOwner = null,
                leaseExpiresAt = null,
                updatedAt = now,
                finishedAt = now
            ).also { jobs[jobId] = it }
            AiJobStatus.CANCELED -> current
            AiJobStatus.SUCCEEDED, AiJobStatus.FAILED -> throw AiJobException(AiJobErrorCode.INVALID_STATE)
        }
    }

    private suspend fun updateRunning(
        jobId: UUID,
        owner: String,
        now: Instant,
        transform: (AiJob) -> AiJob
    ): AiJob = mutex.withLock {
        val current = jobs[jobId] ?: throw AiJobException(AiJobErrorCode.INVALID_STATE)
        if (current.status != AiJobStatus.RUNNING) throw AiJobException(AiJobErrorCode.INVALID_STATE)
        if (current.leaseOwner != owner || current.leaseExpiresAt?.isAfter(now) != true) {
            throw AiJobException(AiJobErrorCode.LEASE_LOST)
        }
        transform(current).also { jobs[jobId] = it }
    }
}
