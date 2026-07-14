package com.orryx.editor.release

import com.orryx.editor.protocol.ReleasePluginState
import com.orryx.editor.protocol.ReleaseRequestData
import com.orryx.editor.protocol.ReleaseResultData
import com.orryx.editor.relay.GameServer
import com.orryx.editor.relay.ReleaseDispatchResult
import com.orryx.editor.relay.ReleaseRelayDispatcher
import kotlinx.serialization.json.Json
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

sealed interface ReleaseProcessingResult {
    data object Idle : ReleaseProcessingResult
    data class Dispatched(val transactionId: UUID, val action: String) : ReleaseProcessingResult
    data class Deferred(val transactionId: UUID, val reason: String) : ReleaseProcessingResult
    data class Failed(val transactionId: UUID, val reason: String) : ReleaseProcessingResult
}

sealed interface PluginReleaseResultOutcome {
    data class Applied(val transaction: PluginReleaseTransaction) : PluginReleaseResultOutcome
    data class Ignored(val reason: String) : PluginReleaseResultOutcome
    data class RetryableFailure(val reason: String) : PluginReleaseResultOutcome
}

class ReleaseTransactionCoordinator(
    private val repository: ReleaseRepository,
    private val dispatcher: ReleaseRelayDispatcher,
    private val snapshots: ReleaseSnapshotService,
    private val publicBaseUrl: URI,
    private val transferTtl: Duration,
    private val transactionLease: Duration,
    private val readinessTimeout: Duration,
    private val maxReleaseBytes: Long,
    private val clock: Clock = Clock.systemUTC(),
    private val random: SecureRandom = SecureRandom()
) {
    private val json = Json { encodeDefaults = false }

    init {
        require(publicBaseUrl.isAbsolute && publicBaseUrl.host != null && publicBaseUrl.userInfo == null) {
            "release publicBaseUrl 必须是无凭据的绝对 URL"
        }
        require(!transferTtl.isZero && !transferTtl.isNegative) { "transferTtl 必须为正数" }
        require(!transactionLease.isZero && !transactionLease.isNegative) { "transactionLease 必须为正数" }
        require(!readinessTimeout.isZero && !readinessTimeout.isNegative) { "readinessTimeout 必须为正数" }
        require(maxReleaseBytes > 0) { "maxReleaseBytes 必须为正数" }
    }

    fun fileUrl(releaseId: UUID, ordinal: Int): String {
        require(ordinal >= 0) { "release file ordinal 不能为负数" }
        return releaseUrl(releaseId, "files/$ordinal")
    }

    suspend fun processNext(workerId: String): ReleaseProcessingResult {
        val now = clock.instant()
        val transaction = repository.claimNext(workerId, now, transactionLease)
            ?: return ReleaseProcessingResult.Idle
        return when (transaction.status) {
            ReleaseTransactionStatus.QUEUED -> dispatchPrepare(transaction, workerId, now)
            ReleaseTransactionStatus.PREPARED -> dispatchCommit(transaction, workerId, now)
            ReleaseTransactionStatus.PREPARE_DISPATCHED,
            ReleaseTransactionStatus.COMMIT_DISPATCHED,
            ReleaseTransactionStatus.READINESS_PENDING -> dispatchStatus(transaction)
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.RECOVERY_REQUIRED -> dispatchRollback(transaction, workerId, now)
            ReleaseTransactionStatus.SUCCEEDED,
            ReleaseTransactionStatus.ROLLED_BACK,
            ReleaseTransactionStatus.FAILED -> ReleaseProcessingResult.Idle
        }
    }

    suspend fun requestRollback(transactionId: UUID, reason: String): PluginReleaseTransaction? {
        val current = repository.findTransaction(transactionId) ?: return null
        return when (current.status) {
            ReleaseTransactionStatus.QUEUED -> transition(current, ReleaseTransactionStatus.FAILED, "CANCELLED_BEFORE_PREPARE")
            ReleaseTransactionStatus.PREPARE_DISPATCHED,
            ReleaseTransactionStatus.PREPARED,
            ReleaseTransactionStatus.COMMIT_DISPATCHED,
            ReleaseTransactionStatus.READINESS_PENDING,
            ReleaseTransactionStatus.RECOVERY_REQUIRED -> transition(
                current,
                ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
                reason.take(100).ifBlank { "ROLLBACK_REQUESTED" }
            )
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.SUCCEEDED,
            ReleaseTransactionStatus.ROLLED_BACK,
            ReleaseTransactionStatus.FAILED -> current
        }
    }

    suspend fun handlePluginResult(server: GameServer, result: ReleaseResultData): PluginReleaseResultOutcome {
        val serverInstanceId = server.serverInstanceId
            ?: return PluginReleaseResultOutcome.Ignored("插件连接未绑定商业 serverInstance")
        if (!HEX_64.matches(result.commandId)) return PluginReleaseResultOutcome.Ignored("commandId 无效")
        val transactionId = parseUuid(result.transactionId)
            ?: return PluginReleaseResultOutcome.Ignored("transactionId 无效")
        val releaseId = parseUuid(result.releaseId)
            ?: return PluginReleaseResultOutcome.Ignored("releaseId 无效")
        val transaction = repository.findTransaction(transactionId)
            ?: return PluginReleaseResultOutcome.Ignored("release transaction 不存在")
        if (transaction.serverInstanceId != serverInstanceId || transaction.releaseId != releaseId) {
            return PluginReleaseResultOutcome.Ignored("release result 与当前插件实例不匹配")
        }
        val release = repository.findRelease(releaseId)
            ?: return PluginReleaseResultOutcome.Ignored("signed release 不存在")
        if (release.serverInstanceId != serverInstanceId) {
            return PluginReleaseResultOutcome.Ignored("signed release 与插件实例不匹配")
        }
        when (appendPluginEvent(transaction.id, result)) {
            is AppendReleaseEventResult.IdempotencyConflict ->
                return PluginReleaseResultOutcome.Ignored("eventId 已被不同 payload 使用")
            AppendReleaseEventResult.TransactionNotFound ->
                return PluginReleaseResultOutcome.Ignored("release transaction 不存在")
            is AppendReleaseEventResult.Appended -> Unit
        }

        val current = repository.findTransaction(transaction.id) ?: transaction
        if (current.status.terminal) return PluginReleaseResultOutcome.Applied(current)
        return try {
            when (result.pluginState) {
                ReleasePluginState.PREPARING -> PluginReleaseResultOutcome.Applied(current)
                ReleasePluginState.PREPARED -> applied(advanceToPrepared(current))
                ReleasePluginState.COMMITTING -> applied(advanceToCommitDispatched(current))
                ReleasePluginState.READINESS_PENDING -> applied(advanceToReadinessPending(current))
                ReleasePluginState.READY -> handleReady(current, release, result)
                ReleasePluginState.ROLLING_BACK -> applied(advanceToRollbackDispatched(current, result.errorCode))
                ReleasePluginState.ROLLED_BACK -> applied(advanceToRolledBack(current, result.errorCode))
                ReleasePluginState.RECOVERY_REQUIRED -> applied(advanceToRecoveryRequired(current, result.errorCode))
                ReleasePluginState.FAILED -> handleFailed(current, result)
            }
        } catch (failure: IllegalStateException) {
            PluginReleaseResultOutcome.RetryableFailure(failure.message ?: "release 状态推进失败")
        }
    }

    private suspend fun dispatchPrepare(
        transaction: PluginReleaseTransaction,
        workerId: String,
        now: Instant
    ): ReleaseProcessingResult {
        val release = repository.findRelease(transaction.releaseId)
            ?: return failClaimed(transaction, workerId, "RELEASE_NOT_FOUND")
        val files = repository.listFiles(release.id)
        val totalBytes = files.sumOf(ReleaseFile::size)
        if (totalBytes > maxReleaseBytes) return failClaimed(transaction, workerId, "RELEASE_TOO_LARGE")
        val rawToken = newTransferToken()
        val expiresAt = now.plus(transferTtl)
        repository.grantTransfer(
            ReleaseTransferGrant(
                id = UUID.randomUUID(),
                releaseId = release.id,
                tokenHash = ReleaseTransferToken.hash(rawToken),
                grantedToServerInstanceId = release.serverInstanceId,
                expiresAt = expiresAt,
                createdAt = now,
                revokedAt = null
            )
        )
        val request = ReleaseRequestData(
            action = "prepare",
            transactionId = transaction.id.toString(),
            releaseId = release.id.toString(),
            commandId = commandId(transaction, "prepare"),
            canonicalVersion = "orryx-release-v1",
            canonicalPayloadSha256 = sha256(release.canonicalPayload),
            signingKeyId = release.keyId,
            signature = release.signature,
            expectedManifestRevision = release.expectedBaseManifestRevision,
            targetManifestRevision = release.targetManifestRevision,
            fileCount = files.size,
            totalBytes = totalBytes,
            operationsUrl = releaseUrl(release.id, "operations"),
            transferToken = rawToken,
            transferExpiresAt = expiresAt.toEpochMilli()
        )
        return try {
            when (val dispatched = dispatcher.dispatch(release.serverInstanceId, request)) {
                is ReleaseDispatchResult.Dispatched -> {
                    val updated = transitionClaimed(
                        transaction,
                        ReleaseTransactionStatus.PREPARE_DISPATCHED,
                        workerId,
                        errorCode = null
                    )
                    if (updated == null) ReleaseProcessingResult.Deferred(transaction.id, "PREPARE_STATE_CONFLICT")
                    else ReleaseProcessingResult.Dispatched(transaction.id, "prepare")
                }
                ReleaseDispatchResult.Offline -> ReleaseProcessingResult.Deferred(transaction.id, "PLUGIN_OFFLINE")
                ReleaseDispatchResult.Disabled -> failClaimed(transaction, workerId, "RELEASE_DISABLED")
                ReleaseDispatchResult.UnsupportedProtocol -> failClaimed(transaction, workerId, "PLUGIN_PROTOCOL_UNSUPPORTED")
                is ReleaseDispatchResult.MissingCapabilities -> failClaimed(
                    transaction,
                    workerId,
                    "PLUGIN_CAPABILITIES_MISSING:${dispatched.capabilities.sorted().joinToString(",")}"
                )
            }
        } finally {
            rawToken.toCharArray().fill('\u0000')
        }
    }

    private suspend fun dispatchCommit(
        transaction: PluginReleaseTransaction,
        workerId: String,
        now: Instant
    ): ReleaseProcessingResult {
        val release = repository.findRelease(transaction.releaseId)
            ?: return failClaimed(transaction, workerId, "RELEASE_NOT_FOUND")
        val request = ReleaseRequestData(
            action = "commit",
            transactionId = transaction.id.toString(),
            releaseId = release.id.toString(),
            commandId = commandId(transaction, "commit"),
            readinessDeadline = now.plus(readinessTimeout).toEpochMilli()
        )
        return when (val dispatched = dispatcher.dispatch(release.serverInstanceId, request)) {
            is ReleaseDispatchResult.Dispatched -> {
                val updated = transitionClaimed(
                    transaction,
                    ReleaseTransactionStatus.COMMIT_DISPATCHED,
                    workerId,
                    errorCode = null
                )
                if (updated == null) ReleaseProcessingResult.Deferred(transaction.id, "COMMIT_STATE_CONFLICT")
                else ReleaseProcessingResult.Dispatched(transaction.id, "commit")
            }
            else -> dispatchFailure(transaction, workerId, dispatched)
        }
    }

    private suspend fun dispatchStatus(transaction: PluginReleaseTransaction): ReleaseProcessingResult {
        val release = repository.findRelease(transaction.releaseId)
            ?: return ReleaseProcessingResult.Failed(transaction.id, "RELEASE_NOT_FOUND")
        val request = ReleaseRequestData(
            action = "status",
            transactionId = transaction.id.toString(),
            releaseId = release.id.toString(),
            commandId = commandId(transaction, "status")
        )
        return when (val dispatched = dispatcher.dispatch(release.serverInstanceId, request)) {
            is ReleaseDispatchResult.Dispatched -> ReleaseProcessingResult.Dispatched(transaction.id, "status")
            ReleaseDispatchResult.Offline -> ReleaseProcessingResult.Deferred(transaction.id, "PLUGIN_OFFLINE")
            else -> ReleaseProcessingResult.Failed(transaction.id, dispatchReason(dispatched))
        }
    }

    private suspend fun dispatchRollback(
        transaction: PluginReleaseTransaction,
        workerId: String,
        now: Instant
    ): ReleaseProcessingResult {
        val release = repository.findRelease(transaction.releaseId)
            ?: return failClaimed(transaction, workerId, "RELEASE_NOT_FOUND")
        val request = ReleaseRequestData(
            action = "rollback",
            transactionId = transaction.id.toString(),
            releaseId = release.id.toString(),
            commandId = commandId(transaction, "rollback"),
            reason = transaction.errorCode ?: "RECOVERY_ROLLBACK"
        )
        return when (val dispatched = dispatcher.dispatch(release.serverInstanceId, request)) {
            is ReleaseDispatchResult.Dispatched -> {
                if (transaction.status == ReleaseTransactionStatus.RECOVERY_REQUIRED) {
                    transitionClaimed(
                        transaction,
                        ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
                        workerId,
                        transaction.errorCode
                    )
                }
                ReleaseProcessingResult.Dispatched(transaction.id, "rollback")
            }
            ReleaseDispatchResult.Offline -> ReleaseProcessingResult.Deferred(transaction.id, "PLUGIN_OFFLINE")
            else -> ReleaseProcessingResult.Failed(transaction.id, dispatchReason(dispatched))
        }
    }

    private suspend fun handleReady(
        current: PluginReleaseTransaction,
        release: SignedRelease,
        result: ReleaseResultData
    ): PluginReleaseResultOutcome {
        val reportedManifest = result.resultManifestRevision ?: result.observedManifestRevision
        if (reportedManifest != release.targetManifestRevision) {
            return applied(advanceToRecoveryRequired(current, "READY_MANIFEST_MISMATCH"))
        }
        val pending = advanceToReadinessPending(current)
        return try {
            snapshots.createForReadyTransaction(pending.id)
            applied(requireTransition(pending, ReleaseTransactionStatus.SUCCEEDED, null))
        } catch (failure: Exception) {
            PluginReleaseResultOutcome.RetryableFailure(
                "READY snapshot 持久化失败: ${failure::class.simpleName}"
            )
        }
    }

    private suspend fun handleFailed(
        current: PluginReleaseTransaction,
        result: ReleaseResultData
    ): PluginReleaseResultOutcome {
        val code = result.errorCode ?: "PLUGIN_FAILED"
        return if (current.status in setOf(
                ReleaseTransactionStatus.QUEUED,
                ReleaseTransactionStatus.PREPARE_DISPATCHED,
                ReleaseTransactionStatus.PREPARED
            )
        ) {
            applied(requireTransition(current, ReleaseTransactionStatus.FAILED, code))
        } else {
            applied(advanceToRecoveryRequired(current, code))
        }
    }

    private suspend fun advanceToPrepared(start: PluginReleaseTransaction): PluginReleaseTransaction {
        var current = start
        if (current.status == ReleaseTransactionStatus.QUEUED) {
            current = requireTransition(current, ReleaseTransactionStatus.PREPARE_DISPATCHED, null)
        }
        if (current.status == ReleaseTransactionStatus.PREPARE_DISPATCHED) {
            current = requireTransition(current, ReleaseTransactionStatus.PREPARED, null)
        }
        check(current.status == ReleaseTransactionStatus.PREPARED) { "无法推进到 PREPARED: ${current.status}" }
        return current
    }

    private suspend fun advanceToCommitDispatched(start: PluginReleaseTransaction): PluginReleaseTransaction {
        var current = advanceToPrepared(start)
        if (current.status == ReleaseTransactionStatus.PREPARED) {
            current = requireTransition(current, ReleaseTransactionStatus.COMMIT_DISPATCHED, null)
        }
        return current
    }

    private suspend fun advanceToReadinessPending(start: PluginReleaseTransaction): PluginReleaseTransaction {
        var current = start
        if (current.status == ReleaseTransactionStatus.QUEUED ||
            current.status == ReleaseTransactionStatus.PREPARE_DISPATCHED ||
            current.status == ReleaseTransactionStatus.PREPARED
        ) {
            current = advanceToCommitDispatched(current)
        }
        if (current.status == ReleaseTransactionStatus.COMMIT_DISPATCHED) {
            current = requireTransition(current, ReleaseTransactionStatus.READINESS_PENDING, null)
        }
        check(current.status == ReleaseTransactionStatus.READINESS_PENDING) {
            "无法推进到 READINESS_PENDING: ${current.status}"
        }
        return current
    }

    private suspend fun advanceToRollbackDispatched(
        start: PluginReleaseTransaction,
        errorCode: String?
    ): PluginReleaseTransaction {
        var current = start
        if (current.status == ReleaseTransactionStatus.ROLLBACK_DISPATCHED) return current
        if (current.status == ReleaseTransactionStatus.QUEUED) {
            current = requireTransition(current, ReleaseTransactionStatus.PREPARE_DISPATCHED, errorCode)
        }
        return requireTransition(current, ReleaseTransactionStatus.ROLLBACK_DISPATCHED, errorCode)
    }

    private suspend fun advanceToRolledBack(
        start: PluginReleaseTransaction,
        errorCode: String?
    ): PluginReleaseTransaction {
        var current = start
        if (current.status != ReleaseTransactionStatus.ROLLBACK_DISPATCHED) {
            current = advanceToRollbackDispatched(current, errorCode)
        }
        return requireTransition(current, ReleaseTransactionStatus.ROLLED_BACK, errorCode)
    }

    private suspend fun advanceToRecoveryRequired(
        start: PluginReleaseTransaction,
        errorCode: String?
    ): PluginReleaseTransaction {
        var current = start
        if (current.status == ReleaseTransactionStatus.RECOVERY_REQUIRED) return current
        if (current.status == ReleaseTransactionStatus.ROLLBACK_DISPATCHED) return current
        if (current.status == ReleaseTransactionStatus.QUEUED) {
            current = requireTransition(current, ReleaseTransactionStatus.PREPARE_DISPATCHED, errorCode)
        }
        return requireTransition(current, ReleaseTransactionStatus.RECOVERY_REQUIRED, errorCode)
    }

    private suspend fun appendPluginEvent(
        transactionId: UUID,
        result: ReleaseResultData
    ): AppendReleaseEventResult {
        val payload = json.encodeToString(ReleaseResultData.serializer(), result)
        repeat(3) {
            val sequence = (repository.listEvents(transactionId).lastOrNull()?.sequence ?: 0L) + 1
            val event = ReleaseEventFactory.create(
                transactionId = transactionId,
                sequence = sequence,
                eventKey = "plugin:${result.eventId}",
                eventType = "plugin.${result.action}.${result.pluginState.name.lowercase()}",
                payload = payload,
                createdAt = clock.instant()
            )
            try {
                return repository.appendEvent(event)
            } catch (_: IllegalArgumentException) {
                // Another result won the sequence race. Reload and retry with the next server sequence.
            }
        }
        throw IllegalStateException("release event sequence 冲突")
    }

    private suspend fun transition(
        transaction: PluginReleaseTransaction,
        target: ReleaseTransactionStatus,
        errorCode: String?
    ): PluginReleaseTransaction? = when (val result = repository.transition(
        transaction.id,
        transaction.stateVersion,
        target,
        clock.instant(),
        leaseOwner = null,
        errorCode = errorCode
    )) {
        is TransitionReleaseResult.Updated -> result.transaction
        is TransitionReleaseResult.Conflict -> repository.findTransaction(transaction.id)?.takeIf { it.status == target }
        is TransitionReleaseResult.IllegalTransition -> null
        TransitionReleaseResult.NotFound -> null
    }

    private suspend fun requireTransition(
        transaction: PluginReleaseTransaction,
        target: ReleaseTransactionStatus,
        errorCode: String?
    ): PluginReleaseTransaction = transition(transaction, target, errorCode)
        ?: throw IllegalStateException("release transition ${transaction.status} -> $target 失败")

    private suspend fun transitionClaimed(
        transaction: PluginReleaseTransaction,
        target: ReleaseTransactionStatus,
        workerId: String,
        errorCode: String?
    ): PluginReleaseTransaction? = when (val result = repository.transition(
        transaction.id,
        transaction.stateVersion,
        target,
        clock.instant(),
        leaseOwner = workerId,
        errorCode = errorCode
    )) {
        is TransitionReleaseResult.Updated -> result.transaction
        is TransitionReleaseResult.Conflict -> null
        is TransitionReleaseResult.IllegalTransition -> null
        TransitionReleaseResult.NotFound -> null
    }

    private suspend fun failClaimed(
        transaction: PluginReleaseTransaction,
        workerId: String,
        errorCode: String
    ): ReleaseProcessingResult {
        val target = if (transaction.status in setOf(
                ReleaseTransactionStatus.QUEUED,
                ReleaseTransactionStatus.PREPARE_DISPATCHED,
                ReleaseTransactionStatus.PREPARED
            )
        ) ReleaseTransactionStatus.FAILED else ReleaseTransactionStatus.RECOVERY_REQUIRED
        transitionClaimed(transaction, target, workerId, errorCode)
        return ReleaseProcessingResult.Failed(transaction.id, errorCode)
    }

    private suspend fun dispatchFailure(
        transaction: PluginReleaseTransaction,
        workerId: String,
        result: ReleaseDispatchResult
    ): ReleaseProcessingResult = when (result) {
        ReleaseDispatchResult.Offline -> ReleaseProcessingResult.Deferred(transaction.id, "PLUGIN_OFFLINE")
        else -> failClaimed(transaction, workerId, dispatchReason(result))
    }

    private fun dispatchReason(result: ReleaseDispatchResult): String = when (result) {
        is ReleaseDispatchResult.Dispatched -> "DISPATCHED"
        ReleaseDispatchResult.Disabled -> "RELEASE_DISABLED"
        ReleaseDispatchResult.Offline -> "PLUGIN_OFFLINE"
        ReleaseDispatchResult.UnsupportedProtocol -> "PLUGIN_PROTOCOL_UNSUPPORTED"
        is ReleaseDispatchResult.MissingCapabilities ->
            "PLUGIN_CAPABILITIES_MISSING:${result.capabilities.sorted().joinToString(",")}"
    }

    private fun applied(transaction: PluginReleaseTransaction): PluginReleaseResultOutcome =
        PluginReleaseResultOutcome.Applied(transaction)

    private fun commandId(transaction: PluginReleaseTransaction, action: String): String = sha256(
        "${transaction.id}\u0000$action\u0000${transaction.stateVersion}".toByteArray(Charsets.UTF_8)
    )

    private fun releaseUrl(releaseId: UUID, suffix: String): String =
        publicBaseUrl.toString().trimEnd('/') + "/api/v2/releases/$releaseId/$suffix"

    private fun newTransferToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return try {
            Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        } finally {
            bytes.fill(0)
        }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun parseUuid(value: String): UUID? = runCatching { UUID.fromString(value) }.getOrNull()

    private companion object {
        val HEX_64 = Regex("^[0-9a-f]{64}$")
    }
}
