package com.orryx.editor.draft

import com.orryx.editor.versioning.AppendDraftVersionRecord
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.DraftFileValidation
import com.orryx.editor.versioning.DraftVersion
import com.orryx.editor.versioning.StoredDraftVersion
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

class InMemoryDraftRepository : DraftRepository {
    private val mutex = Mutex()
    private val drafts = linkedMapOf<UUID, Draft>()
    private val versionsById = mutableMapOf<UUID, StoredDraftVersion>()
    private val versionIdsByDraft = mutableMapOf<UUID, MutableList<UUID>>()

    override suspend fun create(draft: Draft): Draft = mutex.withLock {
        drafts[draft.id]?.let { existing ->
            check(existing == draft) { "draft id 已存在且内容不同: ${draft.id}" }
            return@withLock existing
        }
        require(draft.currentVersion == 0L) { "新 draft 的 currentVersion 必须为 0" }
        drafts[draft.id] = draft
        versionIdsByDraft[draft.id] = mutableListOf()
        draft
    }

    override suspend fun find(id: UUID): Draft? = mutex.withLock { drafts[id] }

    override suspend fun list(accountId: String?, serverInstanceId: String?, limit: Int): List<Draft> = mutex.withLock {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        drafts.values.asSequence()
            .filter { accountId == null || it.accountId == accountId }
            .filter { serverInstanceId == null || it.serverInstanceId == serverInstanceId }
            .sortedWith(compareByDescending<Draft> { it.updatedAt }.thenBy { it.id })
            .take(limit)
            .toList()
    }

    override suspend fun appendVersion(record: AppendDraftVersionRecord): AppendVersionResult = mutex.withLock {
        DraftFileValidation.validate(record.files)
        require(record.expectedCurrentVersion >= 0) { "expectedCurrentVersion 不能为负数" }
        require(record.authorAccountId.isNotBlank()) { "authorAccountId 不能为空" }
        require(com.orryx.editor.snapshot.SnapshotManifest.isSha256(record.manifestRevision)) {
            "manifestRevision 必须是 64 位小写 SHA-256"
        }
        versionsById[record.id]?.let { existing ->
            check(existing.matches(record)) { "draft version id 已存在且内容不同: ${record.id}" }
            return@withLock AppendVersionResult.Created(existing.deepCopy())
        }

        val draft = drafts[record.draftId] ?: return@withLock AppendVersionResult.DraftNotFound
        if (draft.status == DraftStatus.ARCHIVED) return@withLock AppendVersionResult.DraftArchived
        if (draft.currentVersion != record.expectedCurrentVersion) {
            return@withLock AppendVersionResult.Conflict(record.expectedCurrentVersion, draft.currentVersion)
        }

        val nextNumber = draft.currentVersion + 1
        val ids = versionIdsByDraft.getOrPut(draft.id) { mutableListOf() }
        check(ids.none { versionsById.getValue(it).version.versionNumber == nextNumber }) {
            "draft versionNumber 已存在: ${draft.id}/$nextNumber"
        }
        val parentId = ids.lastOrNull()
        val stored = StoredDraftVersion(
            version = DraftVersion(
                id = record.id,
                draftId = record.draftId,
                versionNumber = nextNumber,
                parentVersionId = parentId,
                source = record.source,
                manifestRevision = record.manifestRevision,
                authorAccountId = record.authorAccountId,
                createdAt = record.createdAt
            ),
            files = record.files.toList()
        )
        versionsById[stored.version.id] = stored
        ids += stored.version.id
        drafts[draft.id] = draft.copy(currentVersion = nextNumber, updatedAt = record.createdAt)
        AppendVersionResult.Created(stored.deepCopy())
    }

    override suspend fun findVersion(id: UUID): StoredDraftVersion? = mutex.withLock {
        versionsById[id]?.deepCopy()
    }

    override suspend fun findVersion(draftId: UUID, versionNumber: Long): StoredDraftVersion? = mutex.withLock {
        versionIdsByDraft[draftId].orEmpty().asSequence()
            .mapNotNull(versionsById::get)
            .firstOrNull { it.version.versionNumber == versionNumber }
            ?.deepCopy()
    }

    override suspend fun listVersions(draftId: UUID, limit: Int): List<StoredDraftVersion> = mutex.withLock {
        require(limit in 1..1000) { "limit 必须在 1..1000 范围内" }
        versionIdsByDraft[draftId].orEmpty().asReversed().asSequence()
            .take(limit)
            .mapNotNull(versionsById::get)
            .map { it.deepCopy() }
            .toList()
    }

    private fun StoredDraftVersion.matches(record: AppendDraftVersionRecord): Boolean =
        version.id == record.id &&
            version.draftId == record.draftId &&
            version.versionNumber == record.expectedCurrentVersion + 1 &&
            version.source == record.source &&
            version.manifestRevision == record.manifestRevision &&
            version.authorAccountId == record.authorAccountId &&
            version.createdAt == record.createdAt &&
            files == record.files

    private fun StoredDraftVersion.deepCopy(): StoredDraftVersion = copy(files = files.toList())
}
