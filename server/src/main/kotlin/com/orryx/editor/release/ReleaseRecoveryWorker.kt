package com.orryx.editor.release

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Duration

class ReleaseRecoveryWorker(
    private val coordinator: ReleaseTransactionCoordinator,
    private val workerId: String,
    private val pollInterval: Duration = Duration.ofSeconds(1),
    private val onFailure: (Throwable) -> Unit = {}
) {
    init {
        require(workerId.isNotBlank()) { "release workerId 不能为空" }
        require(!pollInterval.isZero && !pollInterval.isNegative) { "release pollInterval 必须为正数" }
    }

    suspend fun run() {
        while (currentCoroutineContext().isActive) {
            try {
                coordinator.processNext(workerId)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Throwable) {
                onFailure(failure)
            }
            delay(pollInterval.toMillis())
        }
    }
}
