package com.orryx.editor.ai

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class InMemoryAiProviderCatalogRepository(
    entries: Collection<AiProviderCatalogEntry> = emptyList()
) : AiProviderCatalogRepository {
    private val mutex = Mutex()
    private val entries = entries.associateBy(AiProviderCatalogEntry::providerId).toMutableMap()

    override suspend fun list(): List<AiProviderCatalogEntry> = mutex.withLock {
        entries.values.sortedBy(AiProviderCatalogEntry::providerId)
    }

    override suspend fun find(providerId: String): AiProviderCatalogEntry? = mutex.withLock { entries[providerId] }

    override suspend fun updateDynamic(
        providerId: String,
        command: UpdateAiProviderCatalogCommand
    ): AiProviderCatalogEntry? = mutex.withLock {
        val current = entries[providerId] ?: return@withLock null
        current.copy(
            enabled = command.enabled,
            displayName = command.displayName,
            defaultModel = command.defaultModel,
            models = command.models.toList(),
            updatedAt = command.now
        ).also { entries[providerId] = it }
    }
}
