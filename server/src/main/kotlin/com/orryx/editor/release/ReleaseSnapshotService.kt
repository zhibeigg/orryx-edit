package com.orryx.editor.release

import com.orryx.editor.snapshot.CreateSnapshotCommand
import com.orryx.editor.snapshot.ServerSnapshot
import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.snapshot.SnapshotSource
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.util.UUID

class ReleaseSnapshotService(
    private val releases: ReleaseRepository,
    private val snapshots: SnapshotService,
    private val clock: Clock = Clock.systemUTC()
) {
    suspend fun createForReadyTransaction(transactionId: UUID): ServerSnapshot {
        val transaction = requireNotNull(releases.findTransaction(transactionId)) { "release transaction 不存在" }
        require(transaction.status in setOf(
            ReleaseTransactionStatus.COMMIT_DISPATCHED,
            ReleaseTransactionStatus.READINESS_PENDING,
            ReleaseTransactionStatus.SUCCEEDED
        )) { "仅 readiness 已确认的事务可创建 release snapshot" }
        return create(transaction, deterministicSnapshotId(transaction.releaseId))
    }

    suspend fun createForSucceededTransaction(
        transactionId: UUID,
        snapshotId: UUID = deterministicSnapshotIdForTransaction(transactionId)
    ): ServerSnapshot {
        val transaction = requireNotNull(releases.findTransaction(transactionId)) { "release transaction 不存在" }
        require(transaction.status == ReleaseTransactionStatus.SUCCEEDED) { "仅成功事务可创建 release snapshot" }
        return create(transaction, snapshotId)
    }

    private suspend fun create(transaction: PluginReleaseTransaction, snapshotId: UUID): ServerSnapshot {
        val release = requireNotNull(releases.findRelease(transaction.releaseId)) { "release 不存在" }
        val files = releases.listFiles(release.id).map { file ->
            SnapshotFile(file.path, file.contentRevision, file.size, file.content)
        }
        return snapshots.createSnapshot(
            CreateSnapshotCommand(
                serverInstanceId = release.serverInstanceId,
                files = files,
                source = SnapshotSource.RELEASE,
                expectedManifestRevision = release.targetManifestRevision,
                id = snapshotId,
                createdAt = clock.instant()
            )
        )
    }

    private fun deterministicSnapshotId(releaseId: UUID): UUID = UUID.nameUUIDFromBytes(
        "orryx-release-snapshot:$releaseId".toByteArray(StandardCharsets.UTF_8)
    )

    private companion object {
        fun deterministicSnapshotIdForTransaction(transactionId: UUID): UUID = UUID.nameUUIDFromBytes(
            "orryx-release-transaction-snapshot:$transactionId".toByteArray(StandardCharsets.UTF_8)
        )
    }
}
