package com.orryx.editor.release

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import io.r2dbc.spi.Statement
import java.time.Duration
import java.time.Instant
import java.util.UUID

class PostgresReleaseRepository(
    private val database: R2dbcDatabase
) : ReleaseRepository {
    override suspend fun create(record: CreateReleaseRecord): CreateReleaseResult = database.inTransaction { connection ->
        validateRecord(record)
        findTransaction(connection, record.transaction.serverInstanceId, record.transaction.idempotencyKey, true)?.let { existing ->
            return@inTransaction if (existing.requestFingerprint == record.transaction.requestFingerprint) {
                CreateReleaseResult.Created(
                    checkNotNull(findRelease(connection, existing.releaseId)),
                    existing,
                    replayed = true
                )
            } else {
                CreateReleaseResult.IdempotencyConflict(existing.id)
            }
        }
        findActiveTransaction(connection, record.transaction.serverInstanceId, true)?.let { existing ->
            return@inTransaction CreateReleaseResult.ActiveTransactionConflict(existing.id)
        }
        insertRelease(connection, record.release)
        record.files.sortedBy(ReleaseFile::ordinal).forEach { insertFile(connection, it) }
        insertTransaction(connection, record.transaction)
        CreateReleaseResult.Created(record.release.copy(canonicalPayload = record.release.canonicalPayload.copyOf()), record.transaction, false)
    }

    override suspend fun findRelease(releaseId: UUID): SignedRelease? = database.withConnection { findRelease(it, releaseId) }

    override suspend fun findTransaction(transactionId: UUID): PluginReleaseTransaction? = database.withConnection {
        findTransaction(it, transactionId, false)
    }

    override suspend fun findTransaction(serverInstanceId: String, idempotencyKey: String): PluginReleaseTransaction? =
        database.withConnection { findTransaction(it, serverInstanceId, idempotencyKey, false) }

    override suspend fun listFiles(releaseId: UUID): List<ReleaseFile> = database.withConnection { connection ->
        queryAll(
            connection.createStatement(
                "SELECT * FROM commercial_release_files WHERE release_id = $1 ORDER BY ordinal"
            ).bind(0, releaseId)
        ) { row, _ -> row.toReleaseFile() }
    }

    override suspend fun findFile(releaseId: UUID, ordinal: Int): ReleaseFile? = database.withConnection { connection ->
        queryOne(
            connection.createStatement(
                "SELECT * FROM commercial_release_files WHERE release_id = $1 AND ordinal = $2"
            ).bind(0, releaseId).bind(1, ordinal)
        ) { row, _ -> row.toReleaseFile() }
    }

    override suspend fun claimNext(workerId: String, now: Instant, leaseDuration: Duration): PluginReleaseTransaction? =
        database.inTransaction { connection ->
            require(workerId.isNotBlank()) { "workerId 不能为空" }
            require(!leaseDuration.isZero && !leaseDuration.isNegative) { "leaseDuration 必须为正数" }
            val candidate = queryOne(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_plugin_release_transactions
                    WHERE status NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED')
                      AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
                    ORDER BY created_at, transaction_id
                    LIMIT 1 FOR UPDATE SKIP LOCKED
                    """.trimIndent()
                ).bind(0, now)
            ) { row, _ -> row.toTransaction() } ?: return@inTransaction null
            val leaseExpiresAt = now.plus(leaseDuration)
            executeFully(
                connection.createStatement(
                    """
                    UPDATE commercial_plugin_release_transactions
                    SET lease_owner = $2, lease_expires_at = $3, state_version = state_version + 1, updated_at = $4
                    WHERE transaction_id = $1 AND state_version = $5
                    """.trimIndent()
                )
                    .bind(0, candidate.id)
                    .bind(1, workerId)
                    .bind(2, leaseExpiresAt)
                    .bind(3, now)
                    .bind(4, candidate.stateVersion)
            ).also { check(it == 1L) { "release transaction lease CAS 失败" } }
            candidate.copy(
                stateVersion = candidate.stateVersion + 1,
                leaseOwner = workerId,
                leaseExpiresAt = leaseExpiresAt,
                updatedAt = now
            )
        }

    override suspend fun transition(
        transactionId: UUID,
        expectedStateVersion: Long,
        target: ReleaseTransactionStatus,
        now: Instant,
        leaseOwner: String?,
        errorCode: String?
    ): TransitionReleaseResult = database.inTransaction { connection ->
        val current = findTransaction(connection, transactionId, true)
            ?: return@inTransaction TransitionReleaseResult.NotFound
        if (current.stateVersion != expectedStateVersion || (leaseOwner != null && current.leaseOwner != leaseOwner)) {
            return@inTransaction TransitionReleaseResult.Conflict(current.stateVersion)
        }
        if (!ReleaseTransactionTransitions.canTransition(current.status, target)) {
            return@inTransaction TransitionReleaseResult.IllegalTransition(current.status, target)
        }
        val terminal = target.terminal
        val keepLease = !terminal && leaseOwner != null
        val updatedRows = executeFully(
            connection.createStatement(
                """
                UPDATE commercial_plugin_release_transactions
                SET status = $2,
                    state_version = state_version + 1,
                    lease_owner = $3,
                    lease_expires_at = $4,
                    error_code = $5,
                    updated_at = $6,
                    finished_at = $7
                WHERE transaction_id = $1 AND state_version = $8
                """.trimIndent()
            )
                .bind(0, transactionId)
                .bind(1, target.name)
                .bindNullable(2, current.leaseOwner.takeIf { keepLease })
                .bindNullable(3, current.leaseExpiresAt.takeIf { keepLease })
                .bindNullable(4, errorCode)
                .bind(5, now)
                .bindNullable(6, now.takeIf { terminal })
                .bind(7, expectedStateVersion)
        )
        if (updatedRows != 1L) return@inTransaction TransitionReleaseResult.Conflict(current.stateVersion)
        TransitionReleaseResult.Updated(
            current.copy(
                status = target,
                stateVersion = current.stateVersion + 1,
                leaseOwner = current.leaseOwner.takeIf { keepLease },
                leaseExpiresAt = current.leaseExpiresAt.takeIf { keepLease },
                errorCode = errorCode,
                updatedAt = now,
                finishedAt = now.takeIf { terminal }
            )
        )
    }

    override suspend fun appendEvent(event: ReleaseEvent): AppendReleaseEventResult = database.inTransaction { connection ->
        val existing = queryOne(
            connection.createStatement(
                """
                SELECT * FROM commercial_release_events
                WHERE transaction_id = $1 AND event_key = $2
                """.trimIndent()
            ).bind(0, event.transactionId).bind(1, event.eventKey)
        ) { row, _ -> row.toEvent() }
        if (existing != null) {
            return@inTransaction if (existing.payloadFingerprint == event.payloadFingerprint &&
                existing.eventType == event.eventType && existing.payload == event.payload
            ) {
                AppendReleaseEventResult.Appended(existing, replayed = true)
            } else {
                AppendReleaseEventResult.IdempotencyConflict(existing.sequence)
            }
        }
        val transaction = findTransaction(connection, event.transactionId, true)
            ?: return@inTransaction AppendReleaseEventResult.TransactionNotFound
        val lastSequence = queryOne(
            connection.createStatement(
                "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM commercial_release_events WHERE transaction_id = $1"
            ).bind(0, transaction.id)
        ) { row, _ -> row.required("sequence", java.lang.Long::class.java).toLong() } ?: 0L
        require(event.sequence == lastSequence + 1) { "event sequence 必须连续" }
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_release_events(
                    transaction_id, sequence, event_key, event_type, payload,
                    payload_fingerprint, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """.trimIndent()
            )
                .bind(0, event.transactionId)
                .bind(1, event.sequence)
                .bind(2, event.eventKey)
                .bind(3, event.eventType)
                .bind(4, event.payload)
                .bind(5, event.payloadFingerprint)
                .bind(6, event.createdAt)
        )
        AppendReleaseEventResult.Appended(event, replayed = false)
    }

    override suspend fun listEvents(transactionId: UUID, afterSequence: Long): List<ReleaseEvent> =
        database.withConnection { connection ->
            require(afterSequence >= 0) { "afterSequence 不能为负数" }
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_release_events
                    WHERE transaction_id = $1 AND sequence > $2 ORDER BY sequence
                    """.trimIndent()
                ).bind(0, transactionId).bind(1, afterSequence)
            ) { row, _ -> row.toEvent() }
        }

    override suspend fun saveSigningKey(metadata: ReleaseSigningKeyMetadata): ReleaseSigningKeyMetadata =
        database.inTransaction { connection ->
            require(metadata.algorithm == "Ed25519") { "仅支持 Ed25519" }
            val inserted = executeFully(
                connection.createStatement(
                    """
                    INSERT INTO commercial_release_signing_keys(key_id, algorithm, public_key_der, created_at, retired_at)
                    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key_id) DO NOTHING
                    """.trimIndent()
                )
                    .bind(0, metadata.keyId)
                    .bind(1, metadata.algorithm)
                    .bind(2, metadata.publicKeyDer)
                    .bind(3, metadata.createdAt)
                    .bindNullable(4, metadata.retiredAt)
            )
            if (inserted == 1L) metadata.copy(publicKeyDer = metadata.publicKeyDer.copyOf()) else {
                val existing = checkNotNull(findSigningKey(connection, metadata.keyId))
                check(existing.algorithm == metadata.algorithm && existing.publicKeyDer.contentEquals(metadata.publicKeyDer)) {
                    "signing key metadata 冲突"
                }
                existing
            }
        }

    override suspend fun findSigningKey(keyId: String): ReleaseSigningKeyMetadata? =
        database.withConnection { findSigningKey(it, keyId) }

    override suspend fun listSigningKeys(): List<ReleaseSigningKeyMetadata> = database.withConnection { connection ->
        queryAll(
            connection.createStatement(
                "SELECT * FROM commercial_release_signing_keys ORDER BY created_at DESC, key_id"
            )
        ) { row, _ -> row.toSigningKey() }
    }

    override suspend fun grantTransfer(grant: ReleaseTransferGrant): ReleaseTransferGrant = database.inTransaction { connection ->
        val inserted = executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_release_transfer_grants(
                    grant_id, release_id, token_hash, granted_to_server_instance_id,
                    expires_at, created_at, revoked_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (grant_id) DO NOTHING
                """.trimIndent()
            )
                .bind(0, grant.id)
                .bind(1, grant.releaseId)
                .bind(2, grant.tokenHash)
                .bind(3, UUID.fromString(grant.grantedToServerInstanceId))
                .bind(4, grant.expiresAt)
                .bind(5, grant.createdAt)
                .bindNullable(6, grant.revokedAt)
        )
        if (inserted == 1L) grant else {
            val existing = checkNotNull(findGrant(connection, grant.id)) { "transfer grant 冲突后无法读取" }
            check(existing == grant) { "transfer grant id 冲突" }
            existing
        }
    }

    override suspend fun authorizeTransfer(
        releaseId: UUID,
        tokenHash: String,
        serverInstanceId: String,
        now: Instant
    ): ReleaseTransferGrant? = database.withConnection { connection ->
        queryOne(
            connection.createStatement(
                """
                SELECT * FROM commercial_release_transfer_grants
                WHERE release_id = $1 AND token_hash = $2 AND granted_to_server_instance_id = $3
                  AND revoked_at IS NULL AND expires_at > $4
                """.trimIndent()
            )
                .bind(0, releaseId)
                .bind(1, tokenHash)
                .bind(2, UUID.fromString(serverInstanceId))
                .bind(3, now)
        ) { row, _ -> row.toGrant() }
    }

    override suspend fun revokeTransfer(grantId: UUID, revokedAt: Instant): Boolean = database.inTransaction { connection ->
        if (findGrant(connection, grantId) == null) return@inTransaction false
        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_release_transfer_grants SET revoked_at = COALESCE(revoked_at, $2)
                WHERE grant_id = $1
                """.trimIndent()
            ).bind(0, grantId).bind(1, revokedAt)
        )
        true
    }

    private suspend fun insertRelease(connection: Connection, release: SignedRelease) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_releases(
                    release_id, account_id, server_instance_id, stable_server_id, draft_id,
                    draft_version_id, draft_version_number, expected_base_manifest_revision,
                    target_manifest_revision, key_id, canonical_payload, signature, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """.trimIndent()
            )
                .bind(0, release.id)
                .bind(1, UUID.fromString(release.accountId))
                .bind(2, UUID.fromString(release.serverInstanceId))
                .bind(3, release.stableServerId)
                .bind(4, release.draftId)
                .bind(5, release.draftVersionId)
                .bind(6, release.draftVersionNumber)
                .bind(7, release.expectedBaseManifestRevision)
                .bind(8, release.targetManifestRevision)
                .bind(9, release.keyId)
                .bind(10, release.canonicalPayload)
                .bind(11, release.signature)
                .bind(12, release.createdAt)
        )
    }

    private suspend fun insertFile(connection: Connection, file: ReleaseFile) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_release_files(
                    release_id, ordinal, path, change_type, base_revision,
                    content_revision, size, content
                ) VALUES ($1, $2, $3, 'UPSERT', $4, $5, $6, $7)
                """.trimIndent()
            )
                .bind(0, file.releaseId)
                .bind(1, file.ordinal)
                .bind(2, file.path)
                .bindNullable(3, file.baseRevision)
                .bind(4, file.contentRevision)
                .bind(5, file.size)
                .bind(6, file.content)
        )
    }

    private suspend fun insertTransaction(connection: Connection, transaction: PluginReleaseTransaction) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_plugin_release_transactions(
                    transaction_id, release_id, server_instance_id, idempotency_key,
                    request_fingerprint, status, state_version, lease_owner, lease_expires_at,
                    error_code, created_at, updated_at, finished_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """.trimIndent()
            )
                .bind(0, transaction.id)
                .bind(1, transaction.releaseId)
                .bind(2, UUID.fromString(transaction.serverInstanceId))
                .bind(3, transaction.idempotencyKey)
                .bind(4, transaction.requestFingerprint)
                .bind(5, transaction.status.name)
                .bind(6, transaction.stateVersion)
                .bindNullable(7, transaction.leaseOwner)
                .bindNullable(8, transaction.leaseExpiresAt)
                .bindNullable(9, transaction.errorCode)
                .bind(10, transaction.createdAt)
                .bind(11, transaction.updatedAt)
                .bindNullable(12, transaction.finishedAt)
        )
    }

    private suspend fun findRelease(connection: Connection, releaseId: UUID): SignedRelease? = queryOne(
        connection.createStatement("SELECT * FROM commercial_releases WHERE release_id = $1").bind(0, releaseId)
    ) { row, _ -> row.toRelease() }

    private suspend fun findTransaction(
        connection: Connection,
        transactionId: UUID,
        forUpdate: Boolean
    ): PluginReleaseTransaction? {
        val suffix = if (forUpdate) " FOR UPDATE" else ""
        return queryOne(
            connection.createStatement(
                "SELECT * FROM commercial_plugin_release_transactions WHERE transaction_id = $1$suffix"
            ).bind(0, transactionId)
        ) { row, _ -> row.toTransaction() }
    }

    private suspend fun findTransaction(
        connection: Connection,
        serverInstanceId: String,
        idempotencyKey: String,
        forUpdate: Boolean
    ): PluginReleaseTransaction? {
        val suffix = if (forUpdate) " FOR UPDATE" else ""
        return queryOne(
            connection.createStatement(
                """
                SELECT * FROM commercial_plugin_release_transactions
                WHERE server_instance_id = $1 AND idempotency_key = $2$suffix
                """.trimIndent()
            ).bind(0, UUID.fromString(serverInstanceId)).bind(1, idempotencyKey)
        ) { row, _ -> row.toTransaction() }
    }

    private suspend fun findActiveTransaction(
        connection: Connection,
        serverInstanceId: String,
        forUpdate: Boolean
    ): PluginReleaseTransaction? {
        val suffix = if (forUpdate) " FOR UPDATE" else ""
        return queryOne(
            connection.createStatement(
                """
                SELECT * FROM commercial_plugin_release_transactions
                WHERE server_instance_id = $1 AND status NOT IN ('SUCCEEDED', 'ROLLED_BACK', 'FAILED')
                ORDER BY created_at LIMIT 1$suffix
                """.trimIndent()
            ).bind(0, UUID.fromString(serverInstanceId))
        ) { row, _ -> row.toTransaction() }
    }

    private suspend fun findSigningKey(connection: Connection, keyId: String): ReleaseSigningKeyMetadata? = queryOne(
        connection.createStatement("SELECT * FROM commercial_release_signing_keys WHERE key_id = $1").bind(0, keyId)
    ) { row, _ -> row.toSigningKey() }

    private suspend fun findGrant(connection: Connection, grantId: UUID): ReleaseTransferGrant? = queryOne(
        connection.createStatement("SELECT * FROM commercial_release_transfer_grants WHERE grant_id = $1").bind(0, grantId)
    ) { row, _ -> row.toGrant() }

    private fun validateRecord(record: CreateReleaseRecord) {
        require(record.release.id == record.transaction.releaseId) { "release 与 transaction 不匹配" }
        require(record.release.serverInstanceId == record.transaction.serverInstanceId) { "serverInstanceId 不匹配" }
        require(record.transaction.status == ReleaseTransactionStatus.QUEUED && record.transaction.stateVersion == 0L) {
            "新 release transaction 状态无效"
        }
        val sorted = record.files.sortedBy(ReleaseFile::path)
        require(sorted.map(ReleaseFile::ordinal) == sorted.indices.toList()) { "release file ordinal 无效" }
        require(sorted.all { it.releaseId == record.release.id }) { "release file 归属不匹配" }
        require(sorted.all { it.changeType == ReleaseFileChangeType.UPSERT }) { "release files 只能是 UPSERT" }
    }
}

private fun Row.toRelease(): SignedRelease = SignedRelease(
    id = required("release_id", UUID::class.java),
    accountId = required("account_id", UUID::class.java).toString(),
    serverInstanceId = required("server_instance_id", UUID::class.java).toString(),
    stableServerId = required("stable_server_id", String::class.java),
    draftId = required("draft_id", UUID::class.java),
    draftVersionId = required("draft_version_id", UUID::class.java),
    draftVersionNumber = required("draft_version_number", java.lang.Long::class.java).toLong(),
    expectedBaseManifestRevision = required("expected_base_manifest_revision", String::class.java),
    targetManifestRevision = required("target_manifest_revision", String::class.java),
    keyId = required("key_id", String::class.java),
    canonicalPayload = required("canonical_payload", ByteArray::class.java),
    signature = required("signature", String::class.java),
    createdAt = required("created_at", Instant::class.java)
)

private fun Row.toReleaseFile(): ReleaseFile = ReleaseFile(
    releaseId = required("release_id", UUID::class.java),
    ordinal = required("ordinal", Integer::class.java).toInt(),
    path = required("path", String::class.java),
    baseRevision = get("base_revision", String::class.java),
    contentRevision = required("content_revision", String::class.java),
    size = required("size", java.lang.Long::class.java).toLong(),
    content = required("content", String::class.java),
    changeType = ReleaseFileChangeType.valueOf(required("change_type", String::class.java))
)

private fun Row.toTransaction(): PluginReleaseTransaction = PluginReleaseTransaction(
    id = required("transaction_id", UUID::class.java),
    releaseId = required("release_id", UUID::class.java),
    serverInstanceId = required("server_instance_id", UUID::class.java).toString(),
    idempotencyKey = required("idempotency_key", String::class.java),
    requestFingerprint = required("request_fingerprint", String::class.java),
    status = ReleaseTransactionStatus.valueOf(required("status", String::class.java)),
    stateVersion = required("state_version", java.lang.Long::class.java).toLong(),
    leaseOwner = get("lease_owner", String::class.java),
    leaseExpiresAt = get("lease_expires_at", Instant::class.java),
    errorCode = get("error_code", String::class.java),
    createdAt = required("created_at", Instant::class.java),
    updatedAt = required("updated_at", Instant::class.java),
    finishedAt = get("finished_at", Instant::class.java)
)

private fun Row.toEvent(): ReleaseEvent = ReleaseEvent(
    transactionId = required("transaction_id", UUID::class.java),
    sequence = required("sequence", java.lang.Long::class.java).toLong(),
    eventKey = required("event_key", String::class.java),
    eventType = required("event_type", String::class.java),
    payload = required("payload", String::class.java),
    payloadFingerprint = required("payload_fingerprint", String::class.java),
    createdAt = required("created_at", Instant::class.java)
)

private fun Row.toSigningKey(): ReleaseSigningKeyMetadata = ReleaseSigningKeyMetadata(
    keyId = required("key_id", String::class.java),
    algorithm = required("algorithm", String::class.java),
    publicKeyDer = required("public_key_der", ByteArray::class.java),
    createdAt = required("created_at", Instant::class.java),
    retiredAt = get("retired_at", Instant::class.java)
)

private fun Row.toGrant(): ReleaseTransferGrant = ReleaseTransferGrant(
    id = required("grant_id", UUID::class.java),
    releaseId = required("release_id", UUID::class.java),
    tokenHash = required("token_hash", String::class.java),
    grantedToServerInstanceId = required("granted_to_server_instance_id", UUID::class.java).toString(),
    expiresAt = required("expires_at", Instant::class.java),
    createdAt = required("created_at", Instant::class.java),
    revokedAt = get("revoked_at", Instant::class.java)
)

private fun <T : Any> Row.required(name: String, type: Class<T>): T =
    requireNotNull(get(name, type)) { "Postgres 必填列为空: $name" }

private fun Statement.bindNullable(index: Int, value: Instant?): Statement =
    if (value == null) bindNull(index, Instant::class.java) else bind(index, value)
