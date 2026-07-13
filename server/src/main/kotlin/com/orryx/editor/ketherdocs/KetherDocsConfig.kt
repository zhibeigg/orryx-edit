package com.orryx.editor.ketherdocs

import java.net.URI
import java.time.Duration

private const val OFFICIAL_KETHER_DOCS_BASE_URL = "https://zhibeigg.github.io/Orryx/kether/"

data class KetherDocsConfig(
    val enabled: Boolean,
    val syncInterval: Duration,
    val requestTimeout: Duration,
    val maxSchemaBytes: Long,
    val baseUri: URI = URI(OFFICIAL_KETHER_DOCS_BASE_URL),
    val channel: String = "stable",
    val maxChannelBytes: Long = 32L * 1024,
    val maxManifestBytes: Long = 64L * 1024
) {
    init {
        require(baseUri.scheme == "https") { "Kether 文档源必须使用 HTTPS" }
        require(baseUri.host == "zhibeigg.github.io") { "Kether 文档源必须为 Orryx 官方 GitHub Pages" }
        require(baseUri.userInfo == null && baseUri.query == null && baseUri.fragment == null) { "Kether 文档源 URL 无效" }
        require(baseUri.path == "/Orryx/kether/") { "Kether 文档源路径无效" }
        require(channel == "stable") { "生产编辑器只允许同步 stable Kether 文档" }
        require(!syncInterval.isZero && !syncInterval.isNegative) { "Kether 文档同步周期必须为正数" }
        require(!requestTimeout.isZero && !requestTimeout.isNegative) { "Kether 文档请求超时必须为正数" }
        require(maxSchemaBytes in 1L..16L * 1024 * 1024) { "Kether Schema 大小上限无效" }
    }

    companion object {
        fun fromEnvironment(environment: Map<String, String> = System.getenv()): KetherDocsConfig = KetherDocsConfig(
            enabled = environment.strictBoolean("KETHER_DOCS_SYNC_ENABLED", true),
            syncInterval = Duration.ofHours(environment.longValue("KETHER_DOCS_SYNC_INTERVAL_HOURS", 12, 1L..168L)),
            requestTimeout = Duration.ofSeconds(environment.longValue("KETHER_DOCS_REQUEST_TIMEOUT_SECONDS", 20, 1L..120L)),
            maxSchemaBytes = environment.longValue("KETHER_DOCS_MAX_SCHEMA_BYTES", 4L * 1024 * 1024, 64L * 1024..16L * 1024 * 1024)
        )
    }
}

private fun Map<String, String>.strictBoolean(name: String, default: Boolean): Boolean {
    val raw = this[name]?.trim()?.takeIf(String::isNotEmpty) ?: return default
    return raw.toBooleanStrictOrNull() ?: throw IllegalArgumentException("$name 必须为 true 或 false")
}

private fun Map<String, String>.longValue(name: String, default: Long, range: LongRange): Long {
    val raw = this[name]?.trim()?.takeIf(String::isNotEmpty)
    val value = raw?.toLongOrNull() ?: if (raw == null) default else throw IllegalArgumentException("$name 必须为整数")
    require(value in range) { "$name 必须在 ${range.first}..${range.last} 范围内" }
    return value
}
