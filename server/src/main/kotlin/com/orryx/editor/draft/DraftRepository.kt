package com.orryx.editor.draft

import com.orryx.editor.versioning.AppendDraftVersionRecord
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.StoredDraftVersion
import java.util.UUID

interface DraftRepository {
    suspend fun create(draft: Draft): Draft
    suspend fun find(id: UUID): Draft?
    suspend fun list(accountId: String? = null, serverInstanceId: String? = null, limit: Int = 100): List<Draft>
    suspend fun appendVersion(record: AppendDraftVersionRecord): AppendVersionResult
    suspend fun findVersion(id: UUID): StoredDraftVersion?
    suspend fun findVersion(draftId: UUID, versionNumber: Long): StoredDraftVersion?
    suspend fun listVersions(draftId: UUID, limit: Int = 100): List<StoredDraftVersion>
}
