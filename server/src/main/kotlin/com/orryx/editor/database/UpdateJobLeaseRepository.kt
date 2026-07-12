package com.orryx.editor.database

import java.time.Duration
import java.time.Instant

/**
 * 为后续 PostgreSQL UpdateJobStore 适配器提供多实例 lease 原语。
 * 同一 job 仅允许 lease 未过期时的持有实例续租或释放。
 */
class UpdateJobLeaseRepository(private val database: R2dbcDatabase) {
    suspend fun tryAcquire(jobId: String, instanceId: String, now: Instant, leaseDuration: Duration): Boolean {
        require(jobId.isNotBlank()) { "jobId 不能为空" }
        require(instanceId.isNotBlank()) { "instanceId 不能为空" }
        require(!leaseDuration.isNegative && !leaseDuration.isZero) { "leaseDuration 必须大于 0" }
        val leaseExpiresAt = now.plus(leaseDuration)
        return database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    """
                    UPDATE update_jobs
                    SET instance_id = $2, lease_expires_at = $3, updated_at = $4
                    WHERE id = $1
                      AND (instance_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= $4 OR instance_id = $2)
                    """.trimIndent()
                )
                    .bind(0, jobId)
                    .bind(1, instanceId)
                    .bind(2, leaseExpiresAt)
                    .bind(3, now)
            ) > 0
        }
    }

    suspend fun renew(jobId: String, instanceId: String, now: Instant, leaseDuration: Duration): Boolean {
        require(!leaseDuration.isNegative && !leaseDuration.isZero) { "leaseDuration 必须大于 0" }
        return database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    """
                    UPDATE update_jobs
                    SET lease_expires_at = $3, updated_at = $4
                    WHERE id = $1 AND instance_id = $2 AND lease_expires_at > $4
                    """.trimIndent()
                )
                    .bind(0, jobId)
                    .bind(1, instanceId)
                    .bind(2, now.plus(leaseDuration))
                    .bind(3, now)
            ) > 0
        }
    }

    suspend fun release(jobId: String, instanceId: String, now: Instant): Boolean = database.inTransaction { connection ->
        executeFully(
            connection.createStatement(
                """
                UPDATE update_jobs
                SET instance_id = NULL, lease_expires_at = NULL, updated_at = $3
                WHERE id = $1 AND instance_id = $2
                """.trimIndent()
            )
                .bind(0, jobId)
                .bind(1, instanceId)
                .bind(2, now)
        ) > 0
    }
}
