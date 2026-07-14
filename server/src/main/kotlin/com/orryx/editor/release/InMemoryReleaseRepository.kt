package com.orryx.editor.release

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Duration
import java.time.Instant
import java.util.UUID

class InMemoryReleaseRepository : ReleaseRepository {
    private val mutex = Mutex()
    private val releases = linkedMapOf<UUID, SignedRelease>()
    private val files = mutableMapOf<UUID, List<ReleaseFile>>()
    private val transactions = linkedMapOf<UUID, PluginReleaseTransaction>()
    private val idempotency = mutableMapOf<Pair<String, String>, UUID>()
    private val events = mutableMapOf<UUID, MutableList<ReleaseEvent>>()
    private val eventKeys = mutableMapOf<Pair<UUID, String>, ReleaseEvent>()
    private val signingKeys = linkedMapOf<String, ReleaseSigningKeyMetadata>()
    private val grants = linkedMapOf<UUID, ReleaseTransferGrant>()
    private val grantByTokenHash = mutableMapOf<String, UUID>()

    override suspend fun create(record: CreateReleaseRecord): CreateReleaseResult = mutex.withLock {
        validateRecord(record)
        val idempotencyKey = record.transaction.serverInstanceId to record.transaction.idempotencyKey
        idempotency[idempotencyKey]?.let { existingId ->
            val existing = transactions.getValue(existingId)
            return@withLock if (existing.requestFingerprint == record.transaction.requestFingerprint) {
                CreateReleaseResult.Created(
                    release = releases.getValue(existing.releaseId).deepCopy(),
                    transaction = existing.copy(),
                    replayed = true
                )
            } else {
                CreateReleaseResult.IdempotencyConflict(existing.id)
            }
        }
        transactions.values.firstOrNull {
            it.serverInstanceId == record.transaction.serverInstanceId && !it.status.terminal
        }?.let { return@withLock CreateReleaseResult.ActiveTransactionConflict(it.id) }

        releases[record.release.id]?.let { existing ->
            check(existing.contentEquals(record.release)) { "release id 已存在且内容不同" }
        } ?: run { releases[record.release.id] = record.release.deepCopy() }
        files[record.release.id] = record.files.map(ReleaseFile::copy)
        transactions[record.transaction.id] = record.transaction.copy()
        idempotency[idempotencyKey] = record.transaction.id
        events[record.transaction.id] = mutableListOf()
        CreateReleaseResult.Created(record.release.deepCopy(), record.transaction.copy(), replayed = false)
    }

    override suspend fun findRelease(releaseId: UUID): SignedRelease? = mutex.withLock {
        releases[releaseId]?.deepCopy()
    }

    override suspend fun findTransaction(transactionId: UUID): PluginReleaseTransaction? = mutex.withLock {
        transactions[transactionId]?.copy()
    }

    override suspend fun findTransaction(serverInstanceId: String, idempotencyKey: String): PluginReleaseTransaction? =
        mutex.withLock { idempotency[serverInstanceId to idempotencyKey]?.let(transactions::get)?.copy() }

    override suspend fun listReleases(
        accountId: String?,
        serverInstanceId: String?,
        draftId: UUID?,
        limit: Int
    ): List<SignedRelease> = mutex.withLock {
        require(limit in 1..100) { "limit 必须在 1..100 范围内" }
        releases.values.asSequence()
            .filter { accountId == null || it.accountId == accountId }
            .filter { serverInstanceId == null || it.serverInstanceId == serverInstanceId }
            .filter { draftId == null || it.draftId == draftId }
            .sortedWith(compareByDescending<SignedRelease> { it.createdAt }.thenByDescending { it.id })
            .take(limit)
            .map(SignedRelease::deepCopy)
            .toList()
    }

    override suspend fun listTransactions(
        accountId: String?,
        serverInstanceId: String?,
        status: ReleaseTransactionStatus?,
        limit: Int
    ): List<PluginReleaseTransaction> = mutex.withLock {
        require(limit in 1..100) { "limit 必须在 1..100 范围内" }
        transactions.values.asSequence()
            .filter { serverInstanceId == null || it.serverInstanceId == serverInstanceId }
            .filter { status == null || it.status == status }
            .filter { accountId == null || releases[it.releaseId]?.accountId == accountId }
            .sortedWith(compareByDescending<PluginReleaseTransaction> { it.createdAt }.thenByDescending { it.id })
            .take(limit)
            .map(PluginReleaseTransaction::copy)
            .toList()
    }

    override suspend fun listFiles(releaseId: UUID): List<ReleaseFile> = mutex.withLock {
        files[releaseId].orEmpty().map(ReleaseFile::copy)
    }

    override suspend fun findFile(releaseId: UUID, ordinal: Int): ReleaseFile? = mutex.withLock {
        files[releaseId].orEmpty().firstOrNull { it.ordinal == ordinal }?.copy()
    }

    override suspend fun claimNext(workerId: String, now: Instant, leaseDuration: Duration): PluginReleaseTransaction? =
        mutex.withLock {
            require(workerId.isNotBlank()) { "workerId 不能为空" }
            require(!leaseDuration.isZero && !leaseDuration.isNegative) { "leaseDuration 必须为正数" }
            val candidate = transactions.values.asSequence()
                .filter { !it.status.terminal }
                .filter { it.leaseExpiresAt == null || !it.leaseExpiresAt.isAfter(now) }
                .sortedWith(compareBy<PluginReleaseTransaction> { it.createdAt }.thenBy { it.id })
                .firstOrNull() ?: return@withLock null
            val claimed = candidate.copy(
                stateVersion = candidate.stateVersion + 1,
                leaseOwner = workerId,
                leaseExpiresAt = now.plus(leaseDuration),
                updatedAt = now
            )
            transactions[claimed.id] = claimed
            claimed.copy()
        }

    override suspend fun transition(
        transactionId: UUID,
        expectedStateVersion: Long,
        target: ReleaseTransactionStatus,
        now: Instant,
        leaseOwner: String?,
        errorCode: String?
    ): TransitionReleaseResult = mutex.withLock {
        val current = transactions[transactionId] ?: return@withLock TransitionReleaseResult.NotFound
        if (current.stateVersion != expectedStateVersion || (leaseOwner != null && current.leaseOwner != leaseOwner)) {
            return@withLock TransitionReleaseResult.Conflict(current.stateVersion)
        }
        if (!ReleaseTransactionTransitions.canTransition(current.status, target)) {
            return@withLock TransitionReleaseResult.IllegalTransition(current.status, target)
        }
        val keepLease = !target.terminal && leaseOwner != null
        val updated = current.copy(
            status = target,
            stateVersion = current.stateVersion + 1,
            leaseOwner = current.leaseOwner.takeIf { keepLease },
            leaseExpiresAt = current.leaseExpiresAt.takeIf { keepLease },
            errorCode = errorCode,
            updatedAt = now,
            finishedAt = now.takeIf { target.terminal }
        )
        transactions[transactionId] = updated
        TransitionReleaseResult.Updated(updated.copy())
    }

    override suspend fun appendEvent(event: ReleaseEvent): AppendReleaseEventResult = mutex.withLock {
        if (event.transactionId !in transactions) return@withLock AppendReleaseEventResult.TransactionNotFound
        val key = event.transactionId to event.eventKey
        eventKeys[key]?.let { existing ->
            return@withLock if (existing.payloadFingerprint == event.payloadFingerprint &&
                existing.eventType == event.eventType && existing.payload == event.payload
            ) {
                AppendReleaseEventResult.Appended(existing.copy(), replayed = true)
            } else {
                AppendReleaseEventResult.IdempotencyConflict(existing.sequence)
            }
        }
        val transactionEvents = events.getOrPut(event.transactionId) { mutableListOf() }
        val expectedSequence = (transactionEvents.lastOrNull()?.sequence ?: 0) + 1
        require(event.sequence == expectedSequence) { "event sequence 必须连续" }
        val stored = event.copy()
        transactionEvents += stored
        eventKeys[key] = stored
        AppendReleaseEventResult.Appended(stored.copy(), replayed = false)
    }

    override suspend fun listEvents(transactionId: UUID, afterSequence: Long): List<ReleaseEvent> = mutex.withLock {
        require(afterSequence >= 0) { "afterSequence 不能为负数" }
        events[transactionId].orEmpty().filter { it.sequence > afterSequence }.map(ReleaseEvent::copy)
    }

    override suspend fun saveSigningKey(metadata: ReleaseSigningKeyMetadata): ReleaseSigningKeyMetadata = mutex.withLock {
        require(metadata.algorithm == "Ed25519") { "仅支持 Ed25519" }
        signingKeys[metadata.keyId]?.let { existing ->
            check(existing.algorithm == metadata.algorithm && existing.publicKeyDer.contentEquals(metadata.publicKeyDer)) {
                "signing key metadata 冲突"
            }
            return@withLock existing.deepCopy()
        }
        signingKeys[metadata.keyId] = metadata.deepCopy()
        metadata.deepCopy()
    }

    override suspend fun findSigningKey(keyId: String): ReleaseSigningKeyMetadata? = mutex.withLock {
        signingKeys[keyId]?.deepCopy()
    }

    override suspend fun listSigningKeys(): List<ReleaseSigningKeyMetadata> = mutex.withLock {
        signingKeys.values.sortedByDescending { it.createdAt }.map(ReleaseSigningKeyMetadata::deepCopy)
    }

    override suspend fun grantTransfer(grant: ReleaseTransferGrant): ReleaseTransferGrant = mutex.withLock {
        require(grant.releaseId in releases) { "release 不存在" }
        grants[grant.id]?.let { existing ->
            check(existing == grant) { "transfer grant id 冲突" }
            return@withLock existing.copy()
        }
        grantByTokenHash[grant.tokenHash]?.let { existingId ->
            val existing = grants.getValue(existingId)
            check(existing == grant) { "transfer token hash 已存在" }
            return@withLock existing.copy()
        }
        grants[grant.id] = grant.copy()
        grantByTokenHash[grant.tokenHash] = grant.id
        grant.copy()
    }

    override suspend fun authorizeTransfer(
        releaseId: UUID,
        tokenHash: String,
        serverInstanceId: String,
        now: Instant
    ): ReleaseTransferGrant? = mutex.withLock {
        grantByTokenHash[tokenHash]?.let(grants::get)?.takeIf {
            it.releaseId == releaseId && it.grantedToServerInstanceId == serverInstanceId && it.isActive(now)
        }?.copy()
    }

    override suspend fun revokeTransfer(grantId: UUID, revokedAt: Instant): Boolean = mutex.withLock {
        val current = grants[grantId] ?: return@withLock false
        if (current.revokedAt != null) return@withLock true
        grants[grantId] = current.copy(revokedAt = revokedAt)
        true
    }

    private fun validateRecord(record: CreateReleaseRecord) {
        require(record.release.id == record.transaction.releaseId) { "release 与 transaction 不匹配" }
        require(record.release.serverInstanceId == record.transaction.serverInstanceId) { "serverInstanceId 不匹配" }
        require(record.transaction.stateVersion == 0L) { "新事务 stateVersion 必须为 0" }
        require(record.transaction.status == ReleaseTransactionStatus.QUEUED) { "新事务必须为 QUEUED" }
        val sorted = record.files.sortedBy(ReleaseFile::path)
        require(sorted.map(ReleaseFile::ordinal) == sorted.indices.toList()) { "release file ordinal 必须按 path 从 0 连续编号" }
        require(sorted.all { it.releaseId == record.release.id }) { "release file 归属不匹配" }
        require(sorted.all { it.changeType == ReleaseFileChangeType.UPSERT }) { "release files 只能是 UPSERT" }
    }
}

private fun SignedRelease.deepCopy(): SignedRelease = copy(canonicalPayload = canonicalPayload.copyOf())

private fun SignedRelease.contentEquals(other: SignedRelease): Boolean =
    copy(canonicalPayload = byteArrayOf()) == other.copy(canonicalPayload = byteArrayOf()) &&
        canonicalPayload.contentEquals(other.canonicalPayload)

private fun ReleaseSigningKeyMetadata.deepCopy(): ReleaseSigningKeyMetadata = copy(publicKeyDer = publicKeyDer.copyOf())

private fun ReleaseSigningKeyMetadata.contentEquals(other: ReleaseSigningKeyMetadata): Boolean =
    copy(publicKeyDer = byteArrayOf()) == other.copy(publicKeyDer = byteArrayOf()) && publicKeyDer.contentEquals(other.publicKeyDer)
