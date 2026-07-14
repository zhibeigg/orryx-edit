package com.orryx.editor.ai

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import io.r2dbc.spi.Statement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.time.Duration
import java.time.Instant
import java.util.UUID

class PostgresAiJobRepository(
    private val database: R2dbcDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true }
) : AiJobRepository {
    override suspend fun create(command: CreateAiJobCommand): AiJob {
        validateCreateAiJobCommand(command)
        return database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO ai_jobs(
                        id, account_id, server_instance_id, draft_id, base_version_id, status, operation,
                        prompt, provider_id, model, idempotency_key, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, 'QUEUED', $6, $7, $8, $9, $10, $11, $11)
                    ON CONFLICT (account_id, idempotency_key) DO NOTHING
                    """.trimIndent()
                )
                    .bind(0, command.id)
                    .bind(1, command.accountId)
                    .bind(2, command.serverInstanceId)
                    .bindNullableUuid(3, command.draftId)
                    .bindNullableUuid(4, command.baseVersionId)
                    .bind(5, command.operation.name)
                    .bind(6, command.prompt)
                    .bind(7, command.providerId)
                    .bind(8, command.model)
                    .bind(9, command.idempotencyKey)
                    .bind(10, command.now)
            )
            val stored = selectByIdempotency(connection, command.accountId, command.idempotencyKey)
                ?: throw AiJobException(AiJobErrorCode.INTERNAL)
            if (!stored.sameIdempotentRequest(command)) throw AiJobException(AiJobErrorCode.IDEMPOTENCY_CONFLICT)
            stored
        }
    }

    override suspend fun find(id: UUID): AiJob? = database.withConnection { connection -> selectById(connection, id) }

    override suspend fun findByIdempotency(accountId: UUID, idempotencyKey: String): AiJob? =
        database.withConnection { connection -> selectByIdempotency(connection, accountId, idempotencyKey) }

    override suspend fun claimNext(owner: String, now: Instant, leaseDuration: Duration): AiJobLease? {
        require(owner.isNotBlank() && owner.length <= 128) { "lease owner 无效" }
        require(!leaseDuration.isNegative && !leaseDuration.isZero) { "leaseDuration 必须大于 0" }
        return database.inTransaction { connection ->
            val id = queryOne(
                connection.createStatement(
                    """
                    SELECT id FROM ai_jobs
                    WHERE status = 'QUEUED' OR (status = 'RUNNING' AND lease_expires_at <= $1)
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """.trimIndent()
                ).bind(0, now)
            ) { row, _ -> row.required("id", UUID::class.java) } ?: return@inTransaction null
            val expiresAt = now.plus(leaseDuration)
            executeFully(
                connection.createStatement(
                    """
                    UPDATE ai_jobs
                    SET status = 'RUNNING', lease_owner = $2, lease_expires_at = $3,
                        started_at = COALESCE(started_at, $4), finished_at = NULL,
                        error_code = NULL, error_message = NULL, updated_at = $4
                    WHERE id = $1
                    """.trimIndent()
                ).bind(0, id).bind(1, owner).bind(2, expiresAt).bind(3, now)
            )
            val job = selectById(connection, id) ?: throw AiJobException(AiJobErrorCode.INTERNAL)
            AiJobLease(job, owner, expiresAt)
        }
    }

    override suspend fun recordBilling(jobId: UUID, owner: String, billing: AiJobBilling, now: Instant): AiJob =
        updateRunning(jobId, owner, now) { connection ->
            connection.createStatement(
                """
                UPDATE ai_jobs SET
                    provider_request = $4::jsonb, provider_response = $5::jsonb,
                    input_tokens = $6, output_tokens = $7, cost_amount = $8, updated_at = $3
                WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_expires_at > $3
                """.trimIndent()
            )
                .bind(0, jobId)
                .bind(1, owner)
                .bind(2, now)
                .bindNullableJson(3, billing.providerRequest, json)
                .bindNullableJson(4, billing.providerResponse, json)
                .bind(5, billing.usage.inputTokens)
                .bind(6, billing.usage.outputTokens)
                .bind(7, billing.costAmount)
        }

    override suspend fun succeed(
        jobId: UUID,
        owner: String,
        runnerRequest: JsonElement,
        runnerResult: JsonElement,
        now: Instant
    ): AiJob = updateRunning(jobId, owner, now) { connection ->
        connection.createStatement(
            """
            UPDATE ai_jobs SET
                status = 'SUCCEEDED', runner_request = $4::jsonb, runner_result = $5::jsonb,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $3, finished_at = $3
            WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_expires_at > $3
              AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND cost_amount IS NOT NULL
            """.trimIndent()
        ).bind(0, jobId).bind(1, owner).bind(2, now)
            .bind(3, json.encodeToString(JsonElement.serializer(), runnerRequest))
            .bind(4, json.encodeToString(JsonElement.serializer(), runnerResult))
    }

    override suspend fun fail(
        jobId: UUID,
        owner: String,
        errorCode: String,
        errorMessage: String?,
        now: Instant
    ): AiJob = updateRunning(jobId, owner, now) { connection ->
        connection.createStatement(
            """
            UPDATE ai_jobs SET
                status = 'FAILED', error_code = $4, error_message = $5,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $3, finished_at = $3
            WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_expires_at > $3
            """.trimIndent()
        ).bind(0, jobId).bind(1, owner).bind(2, now).bind(3, errorCode).bindNullableString(4, errorMessage)
    }

    override suspend fun requeue(jobId: UUID, owner: String, now: Instant): AiJob = updateRunning(jobId, owner, now) { connection ->
        connection.createStatement(
            """
            UPDATE ai_jobs SET status = 'QUEUED', lease_owner = NULL, lease_expires_at = NULL,
                updated_at = $3, finished_at = NULL
            WHERE id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_expires_at > $3
            """.trimIndent()
        ).bind(0, jobId).bind(1, owner).bind(2, now)
    }

    override suspend fun cancel(jobId: UUID, now: Instant): AiJob? = database.inTransaction { connection ->
        val updated = executeFully(
            connection.createStatement(
                """
                UPDATE ai_jobs SET status = 'CANCELED', lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = $2, finished_at = $2
                WHERE id = $1 AND status IN ('QUEUED', 'RUNNING')
                """.trimIndent()
            ).bind(0, jobId).bind(1, now)
        )
        val current = selectById(connection, jobId) ?: return@inTransaction null
        if (updated == 0L && current.status !in setOf(AiJobStatus.CANCELED)) {
            throw AiJobException(AiJobErrorCode.INVALID_STATE)
        }
        current
    }

    private suspend fun updateRunning(
        jobId: UUID,
        owner: String,
        now: Instant,
        statement: (Connection) -> Statement
    ): AiJob = database.inTransaction { connection ->
        val updated = executeFully(statement(connection))
        if (updated != 1L) {
            val current = selectById(connection, jobId)
            if (current?.status == AiJobStatus.RUNNING) throw AiJobException(AiJobErrorCode.LEASE_LOST)
            throw AiJobException(AiJobErrorCode.INVALID_STATE)
        }
        selectById(connection, jobId) ?: throw AiJobException(AiJobErrorCode.INTERNAL)
    }

    private suspend fun selectById(connection: Connection, id: UUID): AiJob? = queryOne(
        connection.createStatement("$SELECT_COLUMNS WHERE id = $1").bind(0, id)
    ) { row, _ -> row.toAiJob(json) }

    private suspend fun selectByIdempotency(connection: Connection, accountId: UUID, key: String): AiJob? = queryOne(
        connection.createStatement("$SELECT_COLUMNS WHERE account_id = $1 AND idempotency_key = $2")
            .bind(0, accountId).bind(1, key)
    ) { row, _ -> row.toAiJob(json) }

    private companion object {
        val SELECT_COLUMNS = """
            SELECT id, account_id, server_instance_id, draft_id, base_version_id, status, operation,
                prompt, provider_id, model, idempotency_key, lease_owner, lease_expires_at,
                provider_request::text AS provider_request, provider_response::text AS provider_response,
                runner_request::text AS runner_request, runner_result::text AS runner_result,
                input_tokens, output_tokens, cost_amount, error_code, error_message,
                created_at, updated_at, started_at, finished_at
            FROM ai_jobs
        """.trimIndent()
    }
}

private fun Row.toAiJob(json: Json): AiJob {
    val inputTokens = get("input_tokens", java.lang.Long::class.java)?.toLong()
    val outputTokens = get("output_tokens", java.lang.Long::class.java)?.toLong()
    val usage = if (inputTokens != null && outputTokens != null) AiProviderUsage(inputTokens, outputTokens) else null
    return AiJob(
        id = required("id", UUID::class.java),
        accountId = required("account_id", UUID::class.java),
        serverInstanceId = required("server_instance_id", UUID::class.java),
        draftId = get("draft_id", UUID::class.java),
        baseVersionId = get("base_version_id", UUID::class.java),
        status = AiJobStatus.valueOf(required("status", String::class.java)),
        operation = AiOperation.valueOf(required("operation", String::class.java)),
        prompt = required("prompt", String::class.java),
        providerId = required("provider_id", String::class.java),
        model = required("model", String::class.java),
        idempotencyKey = required("idempotency_key", String::class.java),
        leaseOwner = get("lease_owner", String::class.java),
        leaseExpiresAt = get("lease_expires_at", Instant::class.java),
        providerRequest = get("provider_request", String::class.java)?.let(json::parseToJsonElement),
        providerResponse = get("provider_response", String::class.java)?.let(json::parseToJsonElement),
        runnerRequest = get("runner_request", String::class.java)?.let(json::parseToJsonElement),
        runnerResult = get("runner_result", String::class.java)?.let(json::parseToJsonElement),
        usage = usage,
        costAmount = get("cost_amount", java.lang.Long::class.java)?.toLong(),
        errorCode = get("error_code", String::class.java),
        errorMessage = get("error_message", String::class.java),
        createdAt = required("created_at", Instant::class.java),
        updatedAt = required("updated_at", Instant::class.java),
        startedAt = get("started_at", Instant::class.java),
        finishedAt = get("finished_at", Instant::class.java)
    )
}

private fun <T> Row.required(name: String, type: Class<T>): T =
    get(name, type) ?: throw AiJobException(AiJobErrorCode.INTERNAL, "ai_jobs.$name 不能为空")

private fun Statement.bindNullableUuid(index: Int, value: UUID?): Statement =
    if (value == null) bindNull(index, UUID::class.java) else bind(index, value)

private fun Statement.bindNullableString(index: Int, value: String?): Statement =
    if (value == null) bindNull(index, String::class.java) else bind(index, value)

private fun Statement.bindNullableJson(index: Int, value: JsonElement?, json: Json): Statement =
    if (value == null) bindNull(index, String::class.java)
    else bind(index, json.encodeToString(JsonElement.serializer(), value))
