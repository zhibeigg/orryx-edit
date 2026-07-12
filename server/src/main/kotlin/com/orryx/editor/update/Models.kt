package com.orryx.editor.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SemVer(val major: Int, val minor: Int, val patch: Int) : Comparable<SemVer> {
    override fun compareTo(other: SemVer): Int = compareValuesBy(this, other, SemVer::major, SemVer::minor, SemVer::patch)
    override fun toString() = "$major.$minor.$patch"

    companion object {
        private val PATTERN = Regex("^(?:v)?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$")
        fun parse(value: String): SemVer? = PATTERN.matchEntire(value.trim())?.destructured?.let { (a, b, c) ->
            runCatching { SemVer(a.toInt(), b.toInt(), c.toInt()) }.getOrNull()
        }
    }
}

@Serializable
data class GitHubAsset(val name: String, @SerialName("browser_download_url") val downloadUrl: String)

@Serializable
data class GitHubRelease(
    @SerialName("tag_name") val tagName: String,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GitHubAsset> = emptyList()
)

data class ReleaseBundle(
    val version: SemVer,
    val jar: GitHubAsset,
    val checksum: GitHubAsset,
    val manifest: GitHubAsset
)

@Serializable
data class UpdateManifest(val version: String, val artifact: String, val sha256: String)

@Serializable
enum class UpdateJobAction { CHECK, STAGE, APPLY }

@Serializable
enum class UpdateJobStatus { QUEUED, CHECKING, DOWNLOADING, VERIFYING, STAGED, RESTART_PENDING, SUCCEEDED, FAILED }

@Serializable
data class UpdateJob(
    val id: String,
    val action: UpdateJobAction,
    val status: UpdateJobStatus,
    val progress: Int = 0,
    val currentVersion: String,
    val latestVersion: String? = null,
    val deployment: String,
    val activeUsers: Int = 0,
    val errorCode: String? = null,
    val createdAt: Long,
    val updatedAt: Long
) {
    val active: Boolean get() = status in setOf(
        UpdateJobStatus.QUEUED,
        UpdateJobStatus.CHECKING,
        UpdateJobStatus.DOWNLOADING,
        UpdateJobStatus.VERIFYING,
        UpdateJobStatus.RESTART_PENDING
    )
}

@Serializable
data class UpdateOverview(
    val currentVersion: String,
    val latestVersion: String? = null,
    val deployment: String,
    val launcherManaged: Boolean,
    val updateAvailable: Boolean,
    val activeUsers: Int,
    val job: UpdateJob? = null
)

@Serializable
data class StartUpdateRequest(val action: UpdateJobAction = UpdateJobAction.STAGE, val force: Boolean = false)

class UpdateFailure(val code: String) : RuntimeException(code)

object UpdateErrorCode {
    const val UPDATE_DISABLED = "UPDATE_DISABLED"
    const val INVALID_VERSION = "UPDATE_INVALID_VERSION"
    const val RELEASE_UNAVAILABLE = "UPDATE_RELEASE_UNAVAILABLE"
    const val ASSET_MISSING = "UPDATE_ASSET_MISSING"
    const val REDIRECT_REJECTED = "UPDATE_REDIRECT_REJECTED"
    const val DOWNLOAD_TOO_LARGE = "UPDATE_DOWNLOAD_TOO_LARGE"
    const val DOWNLOAD_FAILED = "UPDATE_DOWNLOAD_FAILED"
    const val CHECKSUM_INVALID = "UPDATE_CHECKSUM_INVALID"
    const val MANIFEST_INVALID = "UPDATE_MANIFEST_INVALID"
    const val UPDATE_IN_PROGRESS = "UPDATE_IN_PROGRESS"
    const val APPLY_NOT_SUPPORTED = "UPDATE_APPLY_NOT_SUPPORTED"
    const val ACTIVE_USERS = "UPDATE_ACTIVE_USERS"
    const val IO_FAILED = "UPDATE_IO_FAILED"
}
