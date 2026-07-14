package com.orryx.editor.draft

import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotLimits
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotReader
import com.orryx.editor.versioning.AppendDraftVersionRecord
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import com.orryx.editor.versioning.DraftFileValidation
import com.orryx.editor.versioning.DraftVersionSource
import com.orryx.editor.versioning.StoredDraftVersion
import java.time.Clock
import java.util.Locale
import java.util.UUID

class DraftService(
    private val repository: DraftRepository,
    private val snapshotRepository: SnapshotReader,
    private val limits: SnapshotLimits = SnapshotLimits(),
    private val clock: Clock = Clock.systemUTC()
) {
    suspend fun createDraft(command: CreateDraftCommand): Draft {
        require(command.accountId.isNotBlank()) { "accountId 不能为空" }
        require(command.serverInstanceId.isNotBlank()) { "serverInstanceId 不能为空" }
        require(command.title.isNotBlank()) { "title 不能为空" }
        require(command.title.length <= 160) { "title 长度不能超过 160" }
        val base = requireNotNull(snapshotRepository.find(command.baseSnapshotId)) { "baseSnapshot 不存在" }
        require(base.serverInstanceId == command.serverInstanceId) { "baseSnapshot 不属于指定 serverInstance" }
        val now = command.createdAt ?: clock.instant()
        return repository.create(
            Draft(
                id = command.id,
                accountId = command.accountId,
                serverInstanceId = command.serverInstanceId,
                baseSnapshotId = command.baseSnapshotId,
                title = command.title,
                status = DraftStatus.OPEN,
                currentVersion = 0,
                createdAt = now,
                updatedAt = now
            )
        )
    }

    suspend fun appendVersion(command: AppendDraftVersionCommand): AppendVersionResult {
        require(command.expectedCurrentVersion >= 0) { "expectedCurrentVersion 不能为负数" }
        require(command.authorAccountId.isNotBlank()) { "authorAccountId 不能为空" }
        DraftFileValidation.validate(command.files, limits)
        repository.findVersion(command.id)?.let { existing ->
            check(existing.matches(command)) { "draft version id 已存在且内容不同: ${command.id}" }
            return AppendVersionResult.Created(existing)
        }
        val draft = repository.find(command.draftId) ?: return AppendVersionResult.DraftNotFound
        if (draft.status == DraftStatus.ARCHIVED) return AppendVersionResult.DraftArchived
        if (draft.currentVersion != command.expectedCurrentVersion) {
            return AppendVersionResult.Conflict(command.expectedCurrentVersion, draft.currentVersion)
        }

        val effective = effectiveFiles(draft, command.expectedCurrentVersion)
        applyChanges(effective, command.files)
        val manifestRevision = SnapshotManifest.canonicalRevision(effective.values.map(EffectiveFile::toSnapshotFile), limits)
        return repository.appendVersion(
            AppendDraftVersionRecord(
                id = command.id,
                draftId = command.draftId,
                expectedCurrentVersion = command.expectedCurrentVersion,
                source = command.source,
                manifestRevision = manifestRevision,
                authorAccountId = command.authorAccountId,
                files = command.files.toList(),
                createdAt = command.createdAt ?: clock.instant()
            )
        )
    }

    suspend fun appendAiArtifacts(
        draftId: UUID,
        expectedVersion: Long,
        authorAccountId: String,
        files: List<AiDraftArtifact>,
        versionId: UUID = UUID.randomUUID()
    ): AppendVersionResult {
        val changes = files.map { artifact ->
            val bytes = artifact.content.toByteArray(Charsets.UTF_8)
            DraftFile(
                changeType = DraftFileChangeType.UPSERT,
                path = artifact.path,
                baseRevision = artifact.baseRevision,
                contentRevision = SnapshotManifest.contentRevision(artifact.content),
                size = bytes.size.toLong(),
                content = artifact.content
            )
        }
        return appendVersion(
            AppendDraftVersionCommand(
                id = versionId,
                draftId = draftId,
                expectedCurrentVersion = expectedVersion,
                files = changes,
                source = DraftVersionSource.AI,
                authorAccountId = authorAccountId
            )
        )
    }

    suspend fun get(id: UUID): Draft? = repository.find(id)

    suspend fun list(accountId: String? = null, serverInstanceId: String? = null, limit: Int = 100): List<Draft> =
        repository.list(accountId, serverInstanceId, limit)

    suspend fun getVersion(id: UUID): StoredDraftVersion? = repository.findVersion(id)

    suspend fun getVersion(draftId: UUID, versionNumber: Long): StoredDraftVersion? =
        repository.findVersion(draftId, versionNumber)

    suspend fun listVersions(draftId: UUID, limit: Int = 100): List<StoredDraftVersion> =
        repository.listVersions(draftId, limit)

    private suspend fun effectiveFiles(draft: Draft, throughVersion: Long): MutableMap<String, EffectiveFile> {
        val base = requireNotNull(snapshotRepository.find(draft.baseSnapshotId)) { "baseSnapshot 不存在" }
        val effective = linkedMapOf<String, EffectiveFile>()
        base.files.forEach { file -> effective[file.path.lowercase(Locale.ROOT)] = EffectiveFile(file.path, file.revision, file.size, file.content) }
        for (number in 1..throughVersion) {
            val stored = checkNotNull(repository.findVersion(draft.id, number)) { "draft 版本链不完整: $number" }
            applyStoredChanges(effective, stored.files)
        }
        return effective
    }

    private fun applyChanges(effective: MutableMap<String, EffectiveFile>, changes: List<DraftFile>) {
        changes.forEach { file ->
            val key = file.path.lowercase(Locale.ROOT)
            val current = effective[key]
            require(current == null || current.path == file.path) {
                "文件路径与现有路径大小写冲突: ${current?.path} 与 ${file.path}"
            }
            require(file.baseRevision == current?.revision) {
                "baseRevision 冲突: ${file.path}"
            }
            when (file.changeType) {
                DraftFileChangeType.UPSERT -> effective[key] = EffectiveFile(
                    path = file.path,
                    revision = requireNotNull(file.contentRevision),
                    size = file.size,
                    content = requireNotNull(file.content)
                )

                DraftFileChangeType.DELETE -> effective.remove(key)
            }
        }
    }

    private fun applyStoredChanges(effective: MutableMap<String, EffectiveFile>, changes: List<DraftFile>) {
        changes.forEach { file ->
            val key = file.path.lowercase(Locale.ROOT)
            when (file.changeType) {
                DraftFileChangeType.UPSERT -> effective[key] = EffectiveFile(
                    file.path,
                    requireNotNull(file.contentRevision),
                    file.size,
                    requireNotNull(file.content)
                )

                DraftFileChangeType.DELETE -> effective.remove(key)
            }
        }
    }

    private fun StoredDraftVersion.matches(command: AppendDraftVersionCommand): Boolean =
        version.id == command.id &&
            version.draftId == command.draftId &&
            version.versionNumber == command.expectedCurrentVersion + 1 &&
            version.source == command.source &&
            version.authorAccountId == command.authorAccountId &&
            (command.createdAt == null || version.createdAt == command.createdAt) &&
            files == command.files

    private data class EffectiveFile(
        val path: String,
        val revision: String,
        val size: Long,
        val content: String?
    ) {
        fun toSnapshotFile(): SnapshotFile = SnapshotFile(path, revision, size, content)
    }
}
