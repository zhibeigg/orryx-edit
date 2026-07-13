package com.orryx.editor.ketherdocs

internal interface KetherDocsRepository {
    suspend fun load(channel: String): CachedKetherDocs?
    suspend fun saveSuccess(cache: CachedKetherDocs, state: StoredKetherDocsSyncState)
    suspend fun loadState(channel: String): StoredKetherDocsSyncState?
    suspend fun saveState(state: StoredKetherDocsSyncState)
}
