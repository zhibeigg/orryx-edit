package com.orryx.editor.release

import com.orryx.editor.claim.CommercialTransactionStore
import com.orryx.editor.draft.DraftMaterializer
import com.orryx.editor.draft.DraftRepository
import com.orryx.editor.protocol.ProtocolLimits
import com.orryx.editor.snapshot.SnapshotManifest
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class ReleaseServerIdentity(
    val serverInstanceId: String,
    val stableServerId: String
)

fun interface ReleaseServerAccess {
    suspend fun resolve(accountId: String, serverInstanceId: String): ReleaseServerIdentity?
}

class CommercialReleaseServerAccess(
    private val store: CommercialTransactionStore
) : ReleaseServerAccess {
    override suspend fun resolve(accountId: String, serverInstanceId: String): ReleaseServerIdentity? {
        val instance = store.findServerInstance(serverInstanceId) ?: return null
        val member = store.listMemberships(instance.workspaceId).any { it.accountId == accountId }
        return if (member) ReleaseServerIdentity(instance.id, instance.stableServerId) else null
    }
}

data class PublishReleaseCommand(
    val accountId: String,
    val serverInstanceId: String,
    val draftId: UUID,
    val draftVersionId: UUID,
    val expectedCurrentVersion: Long,
    val expectedBaseManifestRevision: String,
    val idempotencyKey: String,
    val releaseId: UUID = UUID.randomUUID(),
    val transactionId: UUID = UUID.randomUUID(),
    val createdAt: Instant? = null
)

sealed interface PublishReleaseResult {
    data class Accepted(
        val release: SignedRelease,
        val transaction: PluginReleaseTransaction,
        val replayed: Boolean
    ) : PublishReleaseResult

    data class IdempotencyConflict(val existingTransactionId: UUID) : PublishReleaseResult
    data class ActiveTransactionConflict(val existingTransactionId: UUID) : PublishReleaseResult
}

class ReleaseService(
    private val drafts: DraftRepository,
    private val materializer: DraftMaterializer,
    private val repository: ReleaseRepository,
    private val signer: ReleaseSigner,
    private val serverAccess: ReleaseServerAccess,
    private val clock: Clock = Clock.systemUTC()
) {
    suspend fun publish(command: PublishReleaseCommand): PublishReleaseResult {
        require(command.accountId.isNotBlank()) { "accountId 不能为空" }
        require(command.serverInstanceId.isNotBlank()) { "serverInstanceId 不能为空" }
        require(command.expectedCurrentVersion > 0) { "发布版本必须大于 0" }
        require(command.idempotencyKey.length in 1..128) { "Idempotency-Key 长度必须为 1..128" }
        require(SnapshotManifest.isSha256(command.expectedBaseManifestRevision)) {
            "expectedBaseManifestRevision 无效"
        }
        val fingerprint = requestFingerprint(command)
        repository.findTransaction(command.serverInstanceId, command.idempotencyKey)?.let { existing ->
            if (existing.requestFingerprint != fingerprint) {
                return PublishReleaseResult.IdempotencyConflict(existing.id)
            }
            val existingRelease = requireNotNull(repository.findRelease(existing.releaseId)) {
                "幂等事务引用的 release 不存在"
            }
            return PublishReleaseResult.Accepted(existingRelease, existing, replayed = true)
        }
        val identity = requireNotNull(serverAccess.resolve(command.accountId, command.serverInstanceId)) {
            "账户无权访问 serverInstance"
        }
        require(identity.serverInstanceId == command.serverInstanceId) { "serverInstance 解析结果不一致" }
        val draft = requireNotNull(drafts.find(command.draftId)) { "draft 不存在" }
        require(draft.accountId == command.accountId) { "draft 不属于当前账户" }
        require(draft.serverInstanceId == command.serverInstanceId) { "draft 不属于指定 serverInstance" }
        require(draft.currentVersion == command.expectedCurrentVersion) { "draft currentVersion 已变化" }
        val version = requireNotNull(drafts.findVersion(command.draftVersionId)) { "draft version 不存在" }
        require(version.version.draftId == draft.id) { "draft version 不属于指定 draft" }
        require(version.version.versionNumber == command.expectedCurrentVersion) { "只能发布当前 draft version" }

        val materialized = materializer.materialize(draft, command.expectedCurrentVersion)
        require(materialized.files.size <= ProtocolLimits.MAX_MANIFEST_FILES) {
            "release 文件数量超过协议上限 ${ProtocolLimits.MAX_MANIFEST_FILES}"
        }
        require(materialized.baseManifestRevision == command.expectedBaseManifestRevision) {
            "base manifest 已变化"
        }
        require(materialized.targetManifestRevision == version.version.manifestRevision) {
            "目标 manifest 与 draft version 不一致"
        }
        val now = command.createdAt ?: clock.instant()
        val releaseFiles = materialized.files.sortedBy { it.path }.mapIndexed { ordinal, file ->
            ReleaseFile(
                releaseId = command.releaseId,
                ordinal = ordinal,
                path = file.path,
                baseRevision = file.baseRevision,
                contentRevision = file.revision,
                size = file.size,
                content = requireNotNull(file.content) { "目标文件缺少完整内容: ${file.path}" }
            )
        }
        val payload = ReleaseCanonicalPayload.encode(
            ReleaseCanonicalPayload.Input(
                keyId = signer.keyId,
                releaseId = command.releaseId.toString(),
                serverInstanceId = command.serverInstanceId,
                stableServerId = identity.stableServerId,
                draftId = command.draftId.toString(),
                draftVersionId = command.draftVersionId.toString(),
                expectedBaseManifestRevision = materialized.baseManifestRevision,
                targetManifestRevision = materialized.targetManifestRevision,
                createdAtEpochMillis = now.toEpochMilli(),
                files = releaseFiles.map {
                    ReleaseCanonicalPayload.File(it.path, it.baseRevision, it.contentRevision, it.size)
                }
            )
        )
        val release = SignedRelease(
            id = command.releaseId,
            accountId = command.accountId,
            serverInstanceId = command.serverInstanceId,
            stableServerId = identity.stableServerId,
            draftId = command.draftId,
            draftVersionId = command.draftVersionId,
            draftVersionNumber = command.expectedCurrentVersion,
            expectedBaseManifestRevision = materialized.baseManifestRevision,
            targetManifestRevision = materialized.targetManifestRevision,
            keyId = signer.keyId,
            canonicalPayload = payload,
            signature = signer.sign(payload),
            createdAt = now
        )
        val transaction = PluginReleaseTransaction(
            id = command.transactionId,
            releaseId = release.id,
            serverInstanceId = command.serverInstanceId,
            idempotencyKey = command.idempotencyKey,
            requestFingerprint = fingerprint,
            status = ReleaseTransactionStatus.QUEUED,
            stateVersion = 0,
            leaseOwner = null,
            leaseExpiresAt = null,
            errorCode = null,
            createdAt = now,
            updatedAt = now,
            finishedAt = null
        )
        repository.saveSigningKey(
            ReleaseSigningKeyMetadata(signer.keyId, "Ed25519", signer.publicKeyDer, now, retiredAt = null)
        )
        return when (val created = repository.create(CreateReleaseRecord(release, releaseFiles, transaction))) {
            is CreateReleaseResult.Created -> PublishReleaseResult.Accepted(
                created.release,
                created.transaction,
                created.replayed
            )
            is CreateReleaseResult.IdempotencyConflict ->
                PublishReleaseResult.IdempotencyConflict(created.existingTransactionId)
            is CreateReleaseResult.ActiveTransactionConflict ->
                PublishReleaseResult.ActiveTransactionConflict(created.existingTransactionId)
        }
    }

    private fun requestFingerprint(command: PublishReleaseCommand): String {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use { data ->
            listOf(
                command.accountId,
                command.serverInstanceId,
                command.draftId.toString(),
                command.draftVersionId.toString(),
                command.expectedCurrentVersion.toString(),
                command.expectedBaseManifestRevision
            ).forEach { value ->
                val bytes = value.toByteArray(StandardCharsets.UTF_8)
                data.writeInt(bytes.size)
                data.write(bytes)
            }
        }
        return MessageDigest.getInstance("SHA-256").digest(output.toByteArray()).toHex()
    }
}
