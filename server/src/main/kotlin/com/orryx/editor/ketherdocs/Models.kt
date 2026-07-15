package com.orryx.editor.ketherdocs

import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
enum class KetherDocsHealth { UP_TO_DATE, DEGRADED, FAILED }

@Serializable
enum class KetherDocsSource { REMOTE, CACHE, BUNDLED, NONE }

@Serializable
data class KetherDocsStatus(
    val enabled: Boolean,
    val syncing: Boolean,
    val health: KetherDocsHealth,
    val source: KetherDocsSource,
    val channel: String,
    val releaseId: String? = null,
    val pluginVersion: String? = null,
    val commit: String? = null,
    val schemaVersion: Int? = null,
    val schemaSha256: String? = null,
    val schemaBytes: Long? = null,
    val publishedAt: Long? = null,
    val lastAttemptAt: Long? = null,
    val lastSuccessAt: Long? = null,
    val nextAttemptAt: Long? = null,
    val errorCode: String? = null
)

internal data class KetherChannelPointer(
    val releaseId: String,
    val pluginVersion: String,
    val commit: String,
    val publishedAt: Instant,
    val releaseManifest: String
)

internal data class KetherAsset(
    val path: String,
    val mediaType: String,
    val bytes: Long,
    val sha256: String
)

internal data class KetherReleaseManifest(
    val releaseId: String,
    val pluginVersion: String,
    val commit: String,
    /** legacy actions-schema.json 的版本。 */
    val schemaVersion: Int,
    /** 独立 Registry 版本；旧发布清单可缺省。 */
    val registryVersion: Int? = null,
    val generatedAt: Instant,
    val previousReleaseId: String?,
    val schema: KetherAsset,
    val registry: KetherAsset? = null
)

internal data class FetchedKetherDocs(
    val releaseId: String,
    val pluginVersion: String,
    val commit: String,
    /** 当前供新编辑器消费的文档版本（优先 Registry v4）。 */
    val schemaVersion: Int,
    val publishedAt: Instant,
    val schemaSha256: String,
    val schemaBytes: ByteArray,
    /** 兼容旧客户端的 actions-schema.json v3。 */
    val legacySchemaSha256: String? = null,
    val legacySchemaBytes: ByteArray? = null
)

internal data class CachedKetherDocs(
    val channel: String,
    val releaseId: String,
    val pluginVersion: String,
    val commit: String,
    val schemaVersion: Int,
    val schemaSha256: String,
    val schemaBytes: Long,
    val schemaJson: String,
    val publishedAt: Instant,
    val syncedAt: Instant
)

internal data class StoredKetherDocsSyncState(
    val channel: String,
    val lastAttemptAt: Instant?,
    val lastSuccessAt: Instant?,
    val nextAttemptAt: Instant?,
    val errorCode: String?
)

internal data class ActiveKetherDocs(
    val source: KetherDocsSource,
    val releaseId: String?,
    val pluginVersion: String?,
    val commit: String?,
    val schemaVersion: Int,
    val schemaSha256: String,
    val schemaBytes: ByteArray,
    val publishedAt: Instant?,
    val syncedAt: Instant?,
    val legacySchemaSha256: String? = null,
    val legacySchemaBytes: ByteArray? = null
)

class KetherDocsFailure(val code: String) : RuntimeException(code)

object KetherDocsErrorCode {
    const val SYNC_DISABLED = "KETHER_DOCS_SYNC_DISABLED"
    const val CHANNEL_UNAVAILABLE = "KETHER_DOCS_CHANNEL_UNAVAILABLE"
    const val CHANNEL_INVALID = "KETHER_DOCS_CHANNEL_INVALID"
    const val URL_REJECTED = "KETHER_DOCS_URL_REJECTED"
    const val MANIFEST_UNAVAILABLE = "KETHER_DOCS_MANIFEST_UNAVAILABLE"
    const val MANIFEST_INVALID = "KETHER_DOCS_MANIFEST_INVALID"
    const val SCHEMA_UNAVAILABLE = "KETHER_DOCS_SCHEMA_UNAVAILABLE"
    const val SCHEMA_TOO_LARGE = "KETHER_DOCS_SCHEMA_TOO_LARGE"
    const val SCHEMA_SIZE_MISMATCH = "KETHER_DOCS_SCHEMA_SIZE_MISMATCH"
    const val SCHEMA_CHECKSUM_INVALID = "KETHER_DOCS_SCHEMA_CHECKSUM_INVALID"
    const val SCHEMA_UNSUPPORTED = "KETHER_DOCS_SCHEMA_UNSUPPORTED"
    const val SCHEMA_INVALID = "KETHER_DOCS_SCHEMA_INVALID"
    const val CACHE_INVALID = "KETHER_DOCS_CACHE_INVALID"
    const val BUNDLED_FALLBACK = "KETHER_DOCS_BUNDLED_FALLBACK"
    const val REMOTE_SCHEMA_OLDER = "KETHER_DOCS_REMOTE_SCHEMA_OLDER"
    const val NO_USABLE_SCHEMA = "KETHER_DOCS_NO_USABLE_SCHEMA"
    const val SYNC_FAILED = "KETHER_DOCS_SYNC_FAILED"
}
