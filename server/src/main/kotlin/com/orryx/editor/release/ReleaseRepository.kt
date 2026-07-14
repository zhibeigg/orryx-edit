package com.orryx.editor.release

import java.time.Duration
import java.time.Instant
import java.util.UUID

interface ReleaseRepository {
    suspend fun create(record: CreateReleaseRecord): CreateReleaseResult
    suspend fun findRelease(releaseId: UUID): SignedRelease?
    suspend fun findTransaction(transactionId: UUID): PluginReleaseTransaction?
    suspend fun findTransaction(serverInstanceId: String, idempotencyKey: String): PluginReleaseTransaction?
    suspend fun listFiles(releaseId: UUID): List<ReleaseFile>
    suspend fun findFile(releaseId: UUID, ordinal: Int): ReleaseFile?

    suspend fun claimNext(workerId: String, now: Instant, leaseDuration: Duration): PluginReleaseTransaction?

    suspend fun transition(
        transactionId: UUID,
        expectedStateVersion: Long,
        target: ReleaseTransactionStatus,
        now: Instant,
        leaseOwner: String? = null,
        errorCode: String? = null
    ): TransitionReleaseResult

    suspend fun appendEvent(event: ReleaseEvent): AppendReleaseEventResult
    suspend fun listEvents(transactionId: UUID, afterSequence: Long = 0): List<ReleaseEvent>

    suspend fun saveSigningKey(metadata: ReleaseSigningKeyMetadata): ReleaseSigningKeyMetadata
    suspend fun findSigningKey(keyId: String): ReleaseSigningKeyMetadata?
    suspend fun listSigningKeys(): List<ReleaseSigningKeyMetadata>

    suspend fun grantTransfer(grant: ReleaseTransferGrant): ReleaseTransferGrant
    suspend fun authorizeTransfer(
        releaseId: UUID,
        tokenHash: String,
        serverInstanceId: String,
        now: Instant
    ): ReleaseTransferGrant?
    suspend fun revokeTransfer(grantId: UUID, revokedAt: Instant): Boolean
}
