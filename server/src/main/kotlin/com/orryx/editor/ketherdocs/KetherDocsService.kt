package com.orryx.editor.ketherdocs

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

internal data class ServedKetherDocs(
    val bytes: ByteArray,
    val sha256: String,
    val releaseId: String?,
    val source: KetherDocsSource
)

class KetherDocsService internal constructor(
    private val config: KetherDocsConfig,
    private val repository: KetherDocsRepository,
    private val source: KetherDocsUpstream,
    private val validator: KetherDocsValidator,
    private val bundledLoader: suspend () -> ActiveKetherDocs?,
    private val clock: () -> Instant = Instant::now
) {
    @Volatile
    private var active: ActiveKetherDocs? = null

    @Volatile
    private var syncState: StoredKetherDocsSyncState? = null

    private val syncing = AtomicBoolean(false)

    suspend fun initialize() {
        syncState = repository.loadState(config.channel)
        var initialError: String? = null
        val cached = repository.load(config.channel)?.let { stored ->
            try {
                validator.validateCached(stored)
            } catch (failure: KetherDocsFailure) {
                initialError = failure.code
                null
            }
        }
        val bundled = try {
            bundledLoader()
        } catch (failure: KetherDocsFailure) {
            if (initialError == null) initialError = failure.code
            null
        }

        active = when {
            cached != null && (bundled == null || cached.schemaVersion >= bundled.schemaVersion) -> cached.copy(
                legacySchemaSha256 = cached.legacySchemaSha256 ?: bundled?.legacySchemaSha256,
                legacySchemaBytes = cached.legacySchemaBytes ?: bundled?.legacySchemaBytes
            )
            bundled != null -> {
                initialError = if (cached != null) KetherDocsErrorCode.REMOTE_SCHEMA_OLDER
                else initialError ?: KetherDocsErrorCode.BUNDLED_FALLBACK
                bundled
            }
            else -> null
        }

        if (active == null) initialError = KetherDocsErrorCode.NO_USABLE_SCHEMA
        if (!config.enabled) initialError = KetherDocsErrorCode.SYNC_DISABLED

        if (initialError != null) {
            val previous = syncState
            val next = if (config.enabled) clock() else null
            val state = StoredKetherDocsSyncState(
                channel = config.channel,
                lastAttemptAt = previous?.lastAttemptAt,
                lastSuccessAt = previous?.lastSuccessAt,
                nextAttemptAt = next,
                errorCode = initialError
            )
            repository.saveState(state)
            syncState = state
        }
    }

    suspend fun synchronize(): KetherDocsStatus {
        if (!config.enabled) return status()
        if (!syncing.compareAndSet(false, true)) return status()
        val attempt = clock()
        try {
            val fetched = source.fetchLatest()
            val current = active
            if (current != null && current.schemaVersion > fetched.schemaVersion) {
                recordFailure(attempt, KetherDocsErrorCode.REMOTE_SCHEMA_OLDER)
                return status()
            }
            val completed = clock()
            val cache = CachedKetherDocs(
                channel = config.channel,
                releaseId = fetched.releaseId,
                pluginVersion = fetched.pluginVersion,
                commit = fetched.commit,
                schemaVersion = fetched.schemaVersion,
                schemaSha256 = fetched.schemaSha256,
                schemaBytes = fetched.schemaBytes.size.toLong(),
                schemaJson = fetched.schemaBytes.toString(Charsets.UTF_8),
                publishedAt = fetched.publishedAt,
                syncedAt = completed
            )
            val state = StoredKetherDocsSyncState(
                channel = config.channel,
                lastAttemptAt = attempt,
                lastSuccessAt = completed,
                nextAttemptAt = completed.plus(config.syncInterval),
                errorCode = null
            )
            repository.saveSuccess(cache, state)
            active = validator.validateCached(cache).copy(
                source = KetherDocsSource.REMOTE,
                legacySchemaSha256 = fetched.legacySchemaSha256 ?: current?.legacySchemaSha256,
                legacySchemaBytes = fetched.legacySchemaBytes ?: current?.legacySchemaBytes
            )
            syncState = state
        } catch (failure: KetherDocsFailure) {
            recordFailure(attempt, failure.code)
        } catch (failure: CancellationException) {
            throw failure
        } catch (_: Throwable) {
            recordFailure(attempt, KetherDocsErrorCode.SYNC_FAILED)
        } finally {
            syncing.set(false)
        }
        return status()
    }

    suspend fun runScheduler() {
        if (!config.enabled) return
        while (currentCoroutineContext().isActive) {
            synchronize()
            delay(config.syncInterval.toMillis())
        }
    }

    fun status(): KetherDocsStatus {
        val current = active
        val state = syncState
        val errorCode = state?.errorCode
        val health = when {
            current == null -> KetherDocsHealth.FAILED
            errorCode != null || current.source == KetherDocsSource.BUNDLED -> KetherDocsHealth.DEGRADED
            else -> KetherDocsHealth.UP_TO_DATE
        }
        return KetherDocsStatus(
            enabled = config.enabled,
            syncing = syncing.get(),
            health = health,
            source = current?.source ?: KetherDocsSource.NONE,
            channel = config.channel,
            releaseId = current?.releaseId,
            pluginVersion = current?.pluginVersion,
            commit = current?.commit,
            schemaVersion = current?.schemaVersion,
            schemaSha256 = current?.schemaSha256,
            schemaBytes = current?.schemaBytes?.size?.toLong(),
            publishedAt = current?.publishedAt?.toEpochMilli(),
            lastAttemptAt = state?.lastAttemptAt?.toEpochMilli(),
            lastSuccessAt = state?.lastSuccessAt?.toEpochMilli(),
            nextAttemptAt = state?.nextAttemptAt?.toEpochMilli(),
            errorCode = errorCode
        )
    }

    internal fun currentSchema(): ServedKetherDocs? = active?.let { current ->
        ServedKetherDocs(
            bytes = current.schemaBytes,
            sha256 = current.schemaSha256,
            releaseId = current.releaseId,
            source = current.source
        )
    }

    internal fun currentLegacySchema(): ServedKetherDocs? = active?.let { current ->
        val bytes = current.legacySchemaBytes ?: current.schemaBytes
        ServedKetherDocs(
            bytes = bytes,
            sha256 = current.legacySchemaSha256 ?: current.schemaSha256,
            releaseId = current.releaseId,
            source = current.source
        )
    }

    private suspend fun recordFailure(attempt: Instant, code: String) {
        val completed = clock()
        val previous = syncState
        val state = StoredKetherDocsSyncState(
            channel = config.channel,
            lastAttemptAt = attempt,
            lastSuccessAt = previous?.lastSuccessAt,
            nextAttemptAt = completed.plus(config.syncInterval),
            errorCode = code
        )
        syncState = state
        runCatching { repository.saveState(state) }
    }
}
