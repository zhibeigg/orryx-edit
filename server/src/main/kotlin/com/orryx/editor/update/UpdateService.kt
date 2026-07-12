package com.orryx.editor.update

import com.orryx.editor.build.BuildInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Clock
import java.util.UUID

class UpdateService(
    private val buildInfo: BuildInfo,
    private val config: UpdateConfig,
    private val releases: GitHubReleaseClient,
    private val downloader: ArtifactDownloader,
    private val store: UpdateJobStore,
    private val runner: UpdateJobRunner,
    private val activeUsers: () -> Int,
    private val onRestartRequested: suspend () -> Unit = {},
    private val clock: Clock = Clock.systemUTC(),
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
) {
    private val singleFlight = Mutex()

    suspend fun overview(): UpdateOverview {
        val latestJob = store.latest()
        val current = SemVer.parse(buildInfo.version)
        val latest = latestJob?.latestVersion?.let(SemVer::parse)
        return UpdateOverview(
            currentVersion = buildInfo.version,
            latestVersion = latestJob?.latestVersion,
            deployment = buildInfo.deployment,
            launcherManaged = buildInfo.launcherManaged,
            updateAvailable = current != null && latest != null && latest > current,
            activeUsers = activeUsers(),
            job = latestJob
        )
    }

    suspend fun getJob(id: String): UpdateJob? = store.get(id)

    suspend fun start(request: StartUpdateRequest): UpdateJob = singleFlight.withLock {
        if (!config.enabled) throw UpdateFailure(UpdateErrorCode.UPDATE_DISABLED)
        if (store.active() != null) throw UpdateFailure(UpdateErrorCode.UPDATE_IN_PROGRESS)
        if (request.action != UpdateJobAction.CHECK && !canStage()) {
            throw UpdateFailure(UpdateErrorCode.APPLY_NOT_SUPPORTED)
        }
        val users = activeUsers()
        if (request.action == UpdateJobAction.APPLY && users > 0 && !request.force) {
            throw UpdateFailure(UpdateErrorCode.ACTIVE_USERS)
        }
        val now = clock.millis()
        val job = store.create(UpdateJob(
            id = UUID.randomUUID().toString(),
            action = request.action,
            status = UpdateJobStatus.QUEUED,
            currentVersion = buildInfo.version,
            deployment = buildInfo.deployment,
            activeUsers = users,
            createdAt = now,
            updatedAt = now
        ))
        runner.submit { execute(job, request.force) }
        job
    }

    private suspend fun execute(initial: UpdateJob, force: Boolean) {
        var job = initial
        try {
            job = save(job.copy(status = UpdateJobStatus.CHECKING, progress = 5))
            val current = SemVer.parse(buildInfo.version) ?: throw UpdateFailure(UpdateErrorCode.INVALID_VERSION)
            val release = releases.latestStable()
            job = save(job.copy(latestVersion = release.version.toString(), progress = 15))
            if (release.version <= current || job.action == UpdateJobAction.CHECK) {
                save(job.copy(status = UpdateJobStatus.SUCCEEDED, progress = 100))
                return
            }
            val staged = stage(job, release)
            if (job.action == UpdateJobAction.APPLY) {
                if (activeUsers() > 0 && !force) throw UpdateFailure(UpdateErrorCode.ACTIVE_USERS)
                writePendingManifest(release, staged.path.fileName.toString(), staged.sha256)
                save(job.copy(status = UpdateJobStatus.RESTART_PENDING, progress = 100))
                onRestartRequested()
            } else {
                save(job.copy(status = UpdateJobStatus.STAGED, progress = 100))
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: UpdateFailure) {
            save(job.copy(status = UpdateJobStatus.FAILED, errorCode = failure.code))
        } catch (_: Throwable) {
            save(job.copy(status = UpdateJobStatus.FAILED, errorCode = UpdateErrorCode.IO_FAILED))
        }
    }

    private suspend fun stage(job: UpdateJob, release: ReleaseBundle): StagedArtifact {
        val names = expectedNames(release.version)
        val checksumText = downloader.downloadSmall(release.checksum.downloadUrl).decodeToString().trim()
        val expectedChecksum = parseChecksum(checksumText, names.first)
        val manifest = runCatching {
            json.decodeFromString<UpdateManifest>(downloader.downloadSmall(release.manifest.downloadUrl).decodeToString())
        }.getOrElse { throw UpdateFailure(UpdateErrorCode.MANIFEST_INVALID) }
        if (manifest.version != release.version.toString() || manifest.artifact != names.first ||
            !SHA256.matches(manifest.sha256) || !manifest.sha256.equals(expectedChecksum, ignoreCase = true)) {
            throw UpdateFailure(UpdateErrorCode.MANIFEST_INVALID)
        }
        val (temporary, target) = preparePaths(names.first)
        save(job.copy(status = UpdateJobStatus.DOWNLOADING, progress = 20))
        var persistedProgress = 20
        val actual = try {
            downloader.download(release.jar.downloadUrl, temporary) { bytes ->
                val progress = (20 + (bytes * 65 / config.maxBytes)).coerceIn(20, 85).toInt()
                if (progress >= persistedProgress + 2 || progress == 85) {
                    persistedProgress = progress
                    save(job.copy(status = UpdateJobStatus.DOWNLOADING, progress = progress))
                }
            }
        } catch (failure: Throwable) {
            deleteTemporary(temporary)
            throw failure
        }
        save(job.copy(status = UpdateJobStatus.VERIFYING, progress = 90))
        if (!actual.equals(expectedChecksum, ignoreCase = true)) {
            deleteTemporary(temporary)
            throw UpdateFailure(UpdateErrorCode.CHECKSUM_INVALID)
        }
        forceFile(temporary)
        return StagedArtifact(commitStaged(temporary, target), actual.lowercase())
    }

    private fun expectedNames(version: SemVer) = "orryx-editor-$version.jar" to "orryx-editor-$version.jar.sha256"

    private fun parseChecksum(text: String, artifact: String): String {
        val parts = text.split(Regex("\\s+"))
        if (parts.isEmpty() || !SHA256.matches(parts[0])) throw UpdateFailure(UpdateErrorCode.CHECKSUM_INVALID)
        if (parts.size > 1 && parts.last().removePrefix("*") != artifact) throw UpdateFailure(UpdateErrorCode.CHECKSUM_INVALID)
        return parts[0].lowercase()
    }

    private suspend fun preparePaths(fileName: String) = withContext(Dispatchers.IO) {
        val stagedDirectory = config.dataDirectory.resolve("staged")
        Files.createDirectories(stagedDirectory)
        val temporary = stagedDirectory.resolve(".$fileName.${UUID.randomUUID()}.part")
        temporary to stagedDirectory.resolve(fileName)
    }

    private suspend fun commitStaged(temporary: java.nio.file.Path, target: java.nio.file.Path) = withContext(Dispatchers.IO) {
        try {
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING)
        }
        target
    }

    private suspend fun writePendingManifest(release: ReleaseBundle, stagedFile: String, sha256: String) = withContext(Dispatchers.IO) {
        Files.createDirectories(config.dataDirectory)
        val pending = config.dataDirectory.resolve("pending-update.json")
        val temporary = config.dataDirectory.resolve(".pending-update.${UUID.randomUUID()}.tmp")
        val content = json.encodeToString(UpdateManifest(release.version.toString(), stagedFile, sha256))
        Files.writeString(temporary, content, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        java.nio.channels.FileChannel.open(temporary, StandardOpenOption.WRITE).use { it.force(true) }
        try {
            Files.move(temporary, pending, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
            Files.move(temporary, pending, StandardCopyOption.REPLACE_EXISTING)
        }

        // launcher 只解析经过严格字符集校验的三字段清单，避免在 shell 中脆弱解析 JSON。
        val properties = config.dataDirectory.resolve("pending-update.properties")
        val propertiesTemporary = config.dataDirectory.resolve(".pending-update.${UUID.randomUUID()}.properties.tmp")
        Files.writeString(
            propertiesTemporary,
            "version=${release.version}\nartifact=$stagedFile\nsha256=$sha256\n",
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE
        )
        java.nio.channels.FileChannel.open(propertiesTemporary, StandardOpenOption.WRITE).use { it.force(true) }
        try {
            Files.move(propertiesTemporary, properties, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
            Files.move(propertiesTemporary, properties, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private suspend fun forceFile(path: java.nio.file.Path) = withContext(Dispatchers.IO) {
        java.nio.channels.FileChannel.open(path, StandardOpenOption.WRITE).use { it.force(true) }
    }

    private suspend fun deleteTemporary(path: java.nio.file.Path) = withContext(Dispatchers.IO) { Files.deleteIfExists(path) }
    private suspend fun save(job: UpdateJob): UpdateJob = store.update(job.copy(updatedAt = clock.millis()))
    private fun canStage() = buildInfo.launcherManaged && buildInfo.deployment == "launcher"

    private data class StagedArtifact(val path: java.nio.file.Path, val sha256: String)

    companion object { private val SHA256 = Regex("^[a-fA-F0-9]{64}$") }
}
