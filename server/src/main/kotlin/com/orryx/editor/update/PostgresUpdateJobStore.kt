package com.orryx.editor.update

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Row
import java.time.Instant

class PostgresUpdateJobStore(
    private val database: R2dbcDatabase,
    private val instanceId: String
) : UpdateJobStore {
    override suspend fun create(job: UpdateJob): UpdateJob = database.inTransaction { connection ->
        queryOne(
            connection.createStatement("SELECT pg_advisory_xact_lock($1)").bind(0, UPDATE_LOCK_KEY)
        ) { _, _ -> Unit }
        val existing = queryOne(
            connection.createStatement(
                """
                SELECT id FROM update_jobs
                WHERE instance_id = $1 AND status IN ('QUEUED','CHECKING','DOWNLOADING','VERIFYING','RESTART_PENDING')
                ORDER BY created_at DESC LIMIT 1
                """.trimIndent()
            ).bind(0, instanceId)
        ) { row, _ -> row.get("id", String::class.java) }
        if (existing != null) throw UpdateFailure(UpdateErrorCode.UPDATE_IN_PROGRESS)
        executeFully(
            connection.createStatement(
                """
                INSERT INTO update_jobs(
                    id, action, status, payload, error_code, progress, current_version, latest_version,
                    deployment, active_users, instance_id, created_at, updated_at
                ) VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """.trimIndent()
            )
                .bind(0, job.id)
                .bind(1, job.action.name)
                .bind(2, job.status.name)
                .bindNullable(3, job.errorCode)
                .bind(4, job.progress)
                .bind(5, job.currentVersion)
                .bindNullable(6, job.latestVersion)
                .bind(7, job.deployment)
                .bind(8, job.activeUsers)
                .bind(9, instanceId)
                .bind(10, Instant.ofEpochMilli(job.createdAt))
                .bind(11, Instant.ofEpochMilli(job.updatedAt))
        )
        job
    }

    override suspend fun update(job: UpdateJob): UpdateJob = database.inTransaction { connection ->
        val updated = executeFully(
            connection.createStatement(
                """
                UPDATE update_jobs
                SET status = $2, error_code = $3, progress = $4, current_version = $5,
                    latest_version = $6, deployment = $7, active_users = $8, updated_at = $9
                WHERE id = $1 AND instance_id = $10
                """.trimIndent()
            )
                .bind(0, job.id)
                .bind(1, job.status.name)
                .bindNullable(2, job.errorCode)
                .bind(3, job.progress)
                .bind(4, job.currentVersion)
                .bindNullable(5, job.latestVersion)
                .bind(6, job.deployment)
                .bind(7, job.activeUsers)
                .bind(8, Instant.ofEpochMilli(job.updatedAt))
                .bind(9, instanceId)
        )
        check(updated == 1L) { "update job 不存在或不属于当前实例" }
        job
    }

    override suspend fun get(id: String): UpdateJob? = database.withConnection { connection ->
        queryOne(
            connection.createStatement("SELECT * FROM update_jobs WHERE id = $1 AND instance_id = $2")
                .bind(0, id).bind(1, instanceId)
        ) { row, _ -> row.toUpdateJob() }
    }

    override suspend fun latest(): UpdateJob? = database.withConnection { connection ->
        queryOne(
            connection.createStatement(
                "SELECT * FROM update_jobs WHERE instance_id = $1 ORDER BY created_at DESC LIMIT 1"
            ).bind(0, instanceId)
        ) { row, _ -> row.toUpdateJob() }
    }

    override suspend fun active(): UpdateJob? = database.withConnection { connection ->
        queryOne(
            connection.createStatement(
                """
                SELECT * FROM update_jobs
                WHERE instance_id = $1 AND status IN ('QUEUED','CHECKING','DOWNLOADING','VERIFYING','RESTART_PENDING')
                ORDER BY created_at DESC LIMIT 1
                """.trimIndent()
            ).bind(0, instanceId)
        ) { row, _ -> row.toUpdateJob() }
    }

    private fun Row.toUpdateJob(): UpdateJob = UpdateJob(
        id = get("id", String::class.java)!!,
        action = UpdateJobAction.valueOf(get("action", String::class.java)!!),
        status = UpdateJobStatus.valueOf(get("status", String::class.java)!!),
        progress = get("progress", Integer::class.java)!!.toInt(),
        currentVersion = get("current_version", String::class.java)!!,
        latestVersion = get("latest_version", String::class.java),
        deployment = get("deployment", String::class.java)!!,
        activeUsers = get("active_users", Integer::class.java)!!.toInt(),
        errorCode = get("error_code", String::class.java),
        createdAt = get("created_at", Instant::class.java)!!.toEpochMilli(),
        updatedAt = get("updated_at", Instant::class.java)!!.toEpochMilli()
    )

    private companion object {
        const val UPDATE_LOCK_KEY = 5_132_950_496_612_159_112L
    }
}
