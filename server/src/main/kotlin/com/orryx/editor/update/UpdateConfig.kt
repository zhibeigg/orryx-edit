package com.orryx.editor.update

import java.nio.file.Path
import kotlin.io.path.Path

private const val DEFAULT_REPOSITORY = "zhibeigg/orryx-edit"

data class UpdateConfig(
    val enabled: Boolean,
    val repository: String,
    val githubToken: String?,
    val channel: String,
    val maxBytes: Long,
    val dataDirectory: Path,
    val instanceId: String,
    val cacheSeconds: Long,
    val allowedHosts: Set<String> = DEFAULT_ALLOWED_HOSTS
) {
    constructor(
        repository: String,
        githubToken: String?,
        maxBytes: Long,
        dataDirectory: Path,
        allowedHosts: Set<String> = DEFAULT_ALLOWED_HOSTS
    ) : this(
        enabled = true,
        repository = repository,
        githubToken = githubToken,
        channel = "stable",
        maxBytes = maxBytes,
        dataDirectory = dataDirectory,
        instanceId = "test",
        cacheSeconds = 0,
        allowedHosts = allowedHosts
    )

    companion object {
        val DEFAULT_ALLOWED_HOSTS = setOf(
            "api.github.com",
            "github.com",
            "objects.githubusercontent.com",
            "github-releases.githubusercontent.com"
        )

        fun fromEnvironment(environment: Map<String, String> = System.getenv()): UpdateConfig {
            val repository = environment["UPDATE_GITHUB_REPOSITORY"]?.trim().takeUnless { it.isNullOrEmpty() }
                ?: DEFAULT_REPOSITORY
            require(REPOSITORY.matches(repository)) { "UPDATE_GITHUB_REPOSITORY 格式无效" }
            val maxBytes = environment["UPDATE_MAX_BYTES"]?.toLongOrNull() ?: 256L * 1024 * 1024
            require(maxBytes in 1_048_576L..2_147_483_648L) { "UPDATE_MAX_BYTES 必须在 1 MiB..2 GiB 范围内" }
            val channel = environment["UPDATE_CHANNEL"]?.trim()?.lowercase().takeUnless { it.isNullOrEmpty() } ?: "stable"
            require(channel == "stable") { "当前仅支持 stable 更新通道" }
            val instanceId = environment["INSTANCE_ID"]?.trim().takeUnless { it.isNullOrEmpty() } ?: "orryx-editor"
            require(INSTANCE_ID.matches(instanceId)) { "INSTANCE_ID 格式无效" }
            val cacheSeconds = environment["UPDATE_CHECK_CACHE_SECONDS"]?.toLongOrNull() ?: 300L
            require(cacheSeconds in 0L..86_400L) { "UPDATE_CHECK_CACHE_SECONDS 必须在 0..86400 范围内" }
            val dataDirectory = environment["UPDATE_STAGING_DIR"]?.trim().takeUnless { it.isNullOrEmpty() }
                ?.let(::Path)
                ?: Path(environment["DATA_DIR"] ?: "data").resolve("updates")

            return UpdateConfig(
                enabled = environment["UPDATE_ENABLED"]?.toBooleanStrictOrNull() ?: false,
                repository = repository,
                githubToken = environment["UPDATE_GITHUB_TOKEN"]?.trim()?.takeIf(String::isNotEmpty),
                channel = channel,
                maxBytes = maxBytes,
                dataDirectory = dataDirectory.toAbsolutePath().normalize(),
                instanceId = instanceId,
                cacheSeconds = cacheSeconds
            )
        }

        private val REPOSITORY = Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
        private val INSTANCE_ID = Regex("^[A-Za-z0-9_.-]{1,100}$")
    }
}
