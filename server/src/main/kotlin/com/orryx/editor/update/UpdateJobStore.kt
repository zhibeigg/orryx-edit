package com.orryx.editor.update

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface UpdateJobStore {
    suspend fun create(job: UpdateJob): UpdateJob
    suspend fun update(job: UpdateJob): UpdateJob
    suspend fun get(id: String): UpdateJob?
    suspend fun latest(): UpdateJob?
    suspend fun active(): UpdateJob?
}

class InMemoryUpdateJobStore : UpdateJobStore {
    private val mutex = Mutex()
    private val jobs = linkedMapOf<String, UpdateJob>()

    override suspend fun create(job: UpdateJob) = mutex.withLock { jobs[job.id] = job; job }
    override suspend fun update(job: UpdateJob) = mutex.withLock { jobs[job.id] = job; job }
    override suspend fun get(id: String) = mutex.withLock { jobs[id] }
    override suspend fun latest() = mutex.withLock { jobs.values.maxByOrNull(UpdateJob::createdAt) }
    override suspend fun active() = mutex.withLock { jobs.values.lastOrNull(UpdateJob::active) }
}
