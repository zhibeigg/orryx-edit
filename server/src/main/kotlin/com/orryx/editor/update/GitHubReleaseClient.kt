package com.orryx.editor.update

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json

open class GitHubReleaseClient(
    private val client: HttpClient,
    private val config: UpdateConfig,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    open suspend fun latestStable(): ReleaseBundle {
        val endpoint = "https://api.github.com/repos/${config.repository}/releases?per_page=30"
        val response = getFollowingRedirects(endpoint)
        if (!response.status.isSuccess()) throw UpdateFailure(UpdateErrorCode.RELEASE_UNAVAILABLE)
        val releases = runCatching { json.decodeFromString<List<GitHubRelease>>(response.bodyAsText()) }
            .getOrElse { throw UpdateFailure(UpdateErrorCode.RELEASE_UNAVAILABLE) }
        val release = releases.asSequence()
            .filterNot { it.draft || it.prerelease }
            .mapNotNull { release -> SemVer.parse(release.tagName)?.let { it to release } }
            .maxByOrNull { it.first }
            ?: throw UpdateFailure(UpdateErrorCode.RELEASE_UNAVAILABLE)
        val version = release.first
        val assets = release.second.assets.associateBy(GitHubAsset::name)
        val jarName = "orryx-editor-$version.jar"
        return ReleaseBundle(
            version = version,
            jar = assets[jarName] ?: throw UpdateFailure(UpdateErrorCode.ASSET_MISSING),
            checksum = assets["$jarName.sha256"] ?: throw UpdateFailure(UpdateErrorCode.ASSET_MISSING),
            manifest = assets["update-manifest.json"] ?: throw UpdateFailure(UpdateErrorCode.ASSET_MISSING)
        )
    }

    private suspend fun getFollowingRedirects(initialUrl: String): HttpResponse {
        var current = initialUrl
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            val safeUrl = validateUpdateUrl(current, config.allowedHosts)
            val response = client.get(safeUrl) {
                header(HttpHeaders.Accept, "application/vnd.github+json")
                header(HttpHeaders.UserAgent, "orryx-editor-updater")
                config.githubToken?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            }
            if (response.status.value !in 300..399) return response
            if (redirectCount == MAX_REDIRECTS) throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
            current = response.headers[HttpHeaders.Location] ?: throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
        }
        throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
    }

    companion object { private const val MAX_REDIRECTS = 5 }
}
