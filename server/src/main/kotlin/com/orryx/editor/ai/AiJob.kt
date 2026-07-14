package com.orryx.editor.ai

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Serializable
enum class AiJobStatus { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED }

@Serializable
enum class AiOperation { GENERATE, VALIDATE, PLAN }

data class AiJob(
    val id: UUID,
    val accountId: UUID,
    val serverInstanceId: UUID,
    val draftId: UUID?,
    val baseVersionId: UUID?,
    val status: AiJobStatus,
    val operation: AiOperation,
    val prompt: String,
    val providerId: String,
    val model: String,
    val idempotencyKey: String,
    val leaseOwner: String? = null,
    val leaseExpiresAt: Instant? = null,
    val providerRequest: JsonElement? = null,
    val providerResponse: JsonElement? = null,
    val runnerRequest: JsonElement? = null,
    val runnerResult: JsonElement? = null,
    val usage: AiProviderUsage? = null,
    val costAmount: Long? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
    val startedAt: Instant? = null,
    val finishedAt: Instant? = null
) {
    init {
        require(prompt.toByteArray(Charsets.UTF_8).size <= MAX_PROMPT_BYTES) { "prompt 超过最大长度" }
        require(costAmount == null || costAmount >= 0) { "costAmount 不能为负数" }
    }

    companion object {
        const val MAX_PROMPT_BYTES: Int = 64 * 1024
    }
}

data class CreateAiJobCommand(
    val accountId: UUID,
    val serverInstanceId: UUID,
    val draftId: UUID? = null,
    val baseVersionId: UUID? = null,
    val operation: AiOperation,
    val prompt: String,
    val providerId: String,
    val model: String,
    val idempotencyKey: String,
    val now: Instant = Instant.now(),
    val id: UUID = UUID.randomUUID()
)

data class AiJobLease(
    val job: AiJob,
    val owner: String,
    val expiresAt: Instant
)

data class AiJobBilling(
    val usage: AiProviderUsage,
    val costAmount: Long,
    val providerRequest: JsonElement?,
    val providerResponse: JsonElement?
) {
    init {
        require(costAmount >= 0) { "costAmount 不能为负数" }
    }
}

interface AiJobRepository {
    suspend fun create(command: CreateAiJobCommand): AiJob
    suspend fun find(id: UUID): AiJob?
    suspend fun findByIdempotency(accountId: UUID, idempotencyKey: String): AiJob?
    suspend fun claimNext(owner: String, now: Instant, leaseDuration: Duration): AiJobLease?
    suspend fun recordBilling(jobId: UUID, owner: String, billing: AiJobBilling, now: Instant): AiJob
    suspend fun succeed(
        jobId: UUID,
        owner: String,
        runnerRequest: JsonElement,
        runnerResult: JsonElement,
        now: Instant
    ): AiJob
    suspend fun fail(jobId: UUID, owner: String, errorCode: String, errorMessage: String?, now: Instant): AiJob
    suspend fun requeue(jobId: UUID, owner: String, now: Instant): AiJob
    suspend fun cancel(jobId: UUID, now: Instant): AiJob?
}

class AiJobException(val code: String, message: String? = null) : RuntimeException(message ?: code)

object AiJobErrorCode {
    const val INVALID_INPUT = "AI_JOB_INVALID_INPUT"
    const val IDEMPOTENCY_CONFLICT = "AI_JOB_IDEMPOTENCY_CONFLICT"
    const val INVALID_STATE = "AI_JOB_INVALID_STATE"
    const val LEASE_LOST = "AI_JOB_LEASE_LOST"
    const val ACCESS_DENIED = "AI_JOB_ACCESS_DENIED"
    const val PROVIDER_FAILED = "AI_JOB_PROVIDER_FAILED"
    const val RUNNER_FAILED = "AI_JOB_RUNNER_FAILED"
    const val ARTIFACT_FAILED = "AI_JOB_ARTIFACT_FAILED"
    const val BILLING_FAILED = "AI_JOB_BILLING_FAILED"
    const val INTERNAL = "AI_JOB_INTERNAL"
}

internal fun validateCreateAiJobCommand(command: CreateAiJobCommand) {
    require(command.prompt.isNotBlank()) { "prompt 不能为空" }
    require(command.prompt.toByteArray(Charsets.UTF_8).size <= AiJob.MAX_PROMPT_BYTES) { "prompt 超过最大长度" }
    require(command.providerId.matches(Regex("[a-z0-9][a-z0-9._-]{0,63}"))) { "providerId 无效" }
    require(command.model.isNotBlank() && command.model.length <= 128) { "model 无效" }
    require(command.idempotencyKey.isNotBlank() && command.idempotencyKey.length <= 128) { "idempotencyKey 无效" }
}

internal fun AiJob.sameIdempotentRequest(command: CreateAiJobCommand): Boolean =
    accountId == command.accountId &&
        serverInstanceId == command.serverInstanceId &&
        draftId == command.draftId &&
        baseVersionId == command.baseVersionId &&
        operation == command.operation &&
        prompt == command.prompt &&
        providerId == command.providerId &&
        model == command.model &&
        idempotencyKey == command.idempotencyKey
