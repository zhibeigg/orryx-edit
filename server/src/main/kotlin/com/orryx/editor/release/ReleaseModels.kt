package com.orryx.editor.release

import java.time.Instant
import java.util.UUID

data class SignedRelease(
    val id: UUID,
    val accountId: String,
    val serverInstanceId: String,
    val stableServerId: String,
    val draftId: UUID,
    val draftVersionId: UUID,
    val draftVersionNumber: Long,
    val expectedBaseManifestRevision: String,
    val targetManifestRevision: String,
    val keyId: String,
    val canonicalPayload: ByteArray,
    val signature: String,
    val createdAt: Instant
)

data class ReleaseFile(
    val releaseId: UUID,
    val ordinal: Int,
    val path: String,
    val baseRevision: String?,
    val contentRevision: String,
    val size: Long,
    val content: String,
    val changeType: ReleaseFileChangeType = ReleaseFileChangeType.UPSERT
)

enum class ReleaseFileChangeType {
    UPSERT
}

enum class ReleaseTransactionStatus {
    QUEUED,
    PREPARE_DISPATCHED,
    PREPARED,
    COMMIT_DISPATCHED,
    READINESS_PENDING,
    ROLLBACK_DISPATCHED,
    SUCCEEDED,
    ROLLED_BACK,
    FAILED,
    RECOVERY_REQUIRED;

    val terminal: Boolean
        get() = this == SUCCEEDED || this == ROLLED_BACK || this == FAILED
}

data class PluginReleaseTransaction(
    val id: UUID,
    val releaseId: UUID,
    val serverInstanceId: String,
    val idempotencyKey: String,
    val requestFingerprint: String,
    val status: ReleaseTransactionStatus,
    val stateVersion: Long,
    val leaseOwner: String?,
    val leaseExpiresAt: Instant?,
    val errorCode: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val finishedAt: Instant?
)

data class ReleaseEvent(
    val transactionId: UUID,
    val sequence: Long,
    val eventKey: String,
    val eventType: String,
    val payload: String,
    val payloadFingerprint: String,
    val createdAt: Instant
)

data class ReleaseTransferGrant(
    val id: UUID,
    val releaseId: UUID,
    val tokenHash: String,
    val grantedToServerInstanceId: String,
    val expiresAt: Instant,
    val createdAt: Instant,
    val revokedAt: Instant?
) {
    fun isActive(now: Instant): Boolean = revokedAt == null && expiresAt.isAfter(now)
}

data class ReleaseSigningKeyMetadata(
    val keyId: String,
    val algorithm: String,
    val publicKeyDer: ByteArray,
    val createdAt: Instant,
    val retiredAt: Instant?
)

data class CreateReleaseRecord(
    val release: SignedRelease,
    val files: List<ReleaseFile>,
    val transaction: PluginReleaseTransaction
)

sealed interface CreateReleaseResult {
    data class Created(
        val release: SignedRelease,
        val transaction: PluginReleaseTransaction,
        val replayed: Boolean
    ) : CreateReleaseResult

    data class IdempotencyConflict(val existingTransactionId: UUID) : CreateReleaseResult
    data class ActiveTransactionConflict(val existingTransactionId: UUID) : CreateReleaseResult
}

sealed interface TransitionReleaseResult {
    data class Updated(val transaction: PluginReleaseTransaction) : TransitionReleaseResult
    data object NotFound : TransitionReleaseResult
    data class Conflict(val actualStateVersion: Long) : TransitionReleaseResult
    data class IllegalTransition(
        val from: ReleaseTransactionStatus,
        val to: ReleaseTransactionStatus
    ) : TransitionReleaseResult
}

sealed interface AppendReleaseEventResult {
    data class Appended(val event: ReleaseEvent, val replayed: Boolean) : AppendReleaseEventResult
    data class IdempotencyConflict(val existingSequence: Long) : AppendReleaseEventResult
    data object TransactionNotFound : AppendReleaseEventResult
}

object ReleaseTransactionTransitions {
    private val allowed: Map<ReleaseTransactionStatus, Set<ReleaseTransactionStatus>> = mapOf(
        ReleaseTransactionStatus.QUEUED to setOf(
            ReleaseTransactionStatus.PREPARE_DISPATCHED,
            ReleaseTransactionStatus.FAILED
        ),
        ReleaseTransactionStatus.PREPARE_DISPATCHED to setOf(
            ReleaseTransactionStatus.PREPARED,
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.FAILED,
            ReleaseTransactionStatus.RECOVERY_REQUIRED
        ),
        ReleaseTransactionStatus.PREPARED to setOf(
            ReleaseTransactionStatus.COMMIT_DISPATCHED,
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.FAILED,
            ReleaseTransactionStatus.RECOVERY_REQUIRED
        ),
        ReleaseTransactionStatus.COMMIT_DISPATCHED to setOf(
            ReleaseTransactionStatus.READINESS_PENDING,
            ReleaseTransactionStatus.SUCCEEDED,
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.RECOVERY_REQUIRED
        ),
        ReleaseTransactionStatus.READINESS_PENDING to setOf(
            ReleaseTransactionStatus.SUCCEEDED,
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.RECOVERY_REQUIRED
        ),
        ReleaseTransactionStatus.ROLLBACK_DISPATCHED to setOf(
            ReleaseTransactionStatus.ROLLED_BACK,
            ReleaseTransactionStatus.RECOVERY_REQUIRED
        ),
        ReleaseTransactionStatus.RECOVERY_REQUIRED to setOf(
            ReleaseTransactionStatus.ROLLBACK_DISPATCHED,
            ReleaseTransactionStatus.SUCCEEDED,
            ReleaseTransactionStatus.ROLLED_BACK,
            ReleaseTransactionStatus.FAILED
        ),
        ReleaseTransactionStatus.SUCCEEDED to emptySet(),
        ReleaseTransactionStatus.ROLLED_BACK to emptySet(),
        ReleaseTransactionStatus.FAILED to emptySet()
    )

    fun canTransition(from: ReleaseTransactionStatus, to: ReleaseTransactionStatus): Boolean =
        to in allowed.getValue(from)
}
