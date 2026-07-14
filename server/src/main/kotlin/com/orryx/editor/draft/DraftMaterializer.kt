package com.orryx.editor.draft

import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotLimits
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotReader
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import java.util.Locale
import java.util.UUID

data class MaterializedDraft(
    val draft: Draft,
    val versionNumber: Long,
    val baseManifestRevision: String,
    val targetManifestRevision: String,
    val files: List<MaterializedDraftFile>
)

data class MaterializedDraftFile(
    val path: String,
    val baseRevision: String?,
    val revision: String,
    val size: Long,
    val content: String?
) {
    fun toSnapshotFile(): SnapshotFile = SnapshotFile(path, revision, size, content)
}

class DraftMaterializer(
    private val repository: DraftRepository,
    private val snapshots: SnapshotReader,
    private val limits: SnapshotLimits = SnapshotLimits()
) {
    suspend fun materialize(draftId: UUID, throughVersion: Long): MaterializedDraft {
        val draft = requireNotNull(repository.find(draftId)) { "draft 不存在" }
        return materialize(draft, throughVersion)
    }

    suspend fun materialize(draft: Draft, throughVersion: Long): MaterializedDraft {
        require(throughVersion in 0..draft.currentVersion) { "draft 目标版本超出当前版本" }
        val base = requireNotNull(snapshots.find(draft.baseSnapshotId)) { "baseSnapshot 不存在" }
        require(base.serverInstanceId == draft.serverInstanceId) { "baseSnapshot 不属于 draft serverInstance" }
        require(base.manifestRevision == SnapshotManifest.canonicalRevision(base.files, limits)) {
            "baseSnapshot manifestRevision 无效"
        }
        val baseRevisions = base.files.associate { it.path.lowercase(Locale.ROOT) to it.revision }
        val effective = linkedMapOf<String, EffectiveFile>()
        base.files.forEach { file ->
            effective[file.path.lowercase(Locale.ROOT)] = EffectiveFile(file.path, file.revision, file.size, file.content)
        }
        for (number in 1..throughVersion) {
            val stored = checkNotNull(repository.findVersion(draft.id, number)) { "draft 版本链不完整: $number" }
            check(stored.version.versionNumber == number) { "draft 版本号不连续: $number" }
            apply(effective, stored.files, verifyBaseRevision = true)
            val actualManifest = SnapshotManifest.canonicalRevision(effective.values.map(EffectiveFile::toSnapshotFile), limits)
            check(actualManifest == stored.version.manifestRevision) { "draft 版本 manifest 不一致: $number" }
        }
        val files = effective.values.sortedBy(EffectiveFile::path).map { file ->
            MaterializedDraftFile(
                path = file.path,
                baseRevision = baseRevisions[file.path.lowercase(Locale.ROOT)],
                revision = file.revision,
                size = file.size,
                content = file.content
            )
        }
        return MaterializedDraft(
            draft = draft,
            versionNumber = throughVersion,
            baseManifestRevision = base.manifestRevision,
            targetManifestRevision = SnapshotManifest.canonicalRevision(files.map(MaterializedDraftFile::toSnapshotFile), limits),
            files = files
        )
    }

    fun applyCandidate(base: MaterializedDraft, changes: List<DraftFile>): MaterializedDraft {
        val effective = linkedMapOf<String, EffectiveFile>()
        base.files.forEach { file ->
            effective[file.path.lowercase(Locale.ROOT)] = EffectiveFile(file.path, file.revision, file.size, file.content)
        }
        apply(effective, changes, verifyBaseRevision = true)
        val baseRevisions = base.files.associate { it.path.lowercase(Locale.ROOT) to it.baseRevision }
        val files = effective.values.sortedBy(EffectiveFile::path).map { file ->
            MaterializedDraftFile(
                file.path,
                baseRevisions[file.path.lowercase(Locale.ROOT)],
                file.revision,
                file.size,
                file.content
            )
        }
        return base.copy(
            versionNumber = base.versionNumber + 1,
            targetManifestRevision = SnapshotManifest.canonicalRevision(files.map(MaterializedDraftFile::toSnapshotFile), limits),
            files = files
        )
    }

    private fun apply(
        effective: MutableMap<String, EffectiveFile>,
        changes: List<DraftFile>,
        verifyBaseRevision: Boolean
    ) {
        changes.forEach { file ->
            val key = file.path.lowercase(Locale.ROOT)
            val current = effective[key]
            require(current == null || current.path == file.path) {
                "文件路径与现有路径大小写冲突: ${current?.path} 与 ${file.path}"
            }
            if (verifyBaseRevision) {
                require(file.baseRevision == current?.revision) { "baseRevision 冲突: ${file.path}" }
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

    private data class EffectiveFile(
        val path: String,
        val revision: String,
        val size: Long,
        val content: String?
    ) {
        fun toSnapshotFile(): SnapshotFile = SnapshotFile(path, revision, size, content)
    }
}
