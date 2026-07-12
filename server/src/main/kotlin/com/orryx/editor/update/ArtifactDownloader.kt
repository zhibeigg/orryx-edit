package com.orryx.editor.update

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.suspendCancellableCoroutine
import java.nio.ByteBuffer
import java.nio.channels.AsynchronousFileChannel
import java.nio.channels.CompletionHandler
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

open class ArtifactDownloader(
    private val client: HttpClient,
    private val config: UpdateConfig
) {
    open suspend fun download(url: String, target: Path, onProgress: suspend (Long) -> Unit = {}): String {
        val response = getFollowingRedirects(url)
        if (!response.status.isSuccess()) throw UpdateFailure(UpdateErrorCode.DOWNLOAD_FAILED)
        response.headers[HttpHeaders.ContentLength]?.toLongOrNull()?.let {
            if (it > config.maxBytes) throw UpdateFailure(UpdateErrorCode.DOWNLOAD_TOO_LARGE)
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val channel = response.bodyAsChannel()
        val file = runCatching {
            AsynchronousFileChannel.open(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        }.getOrElse { throw UpdateFailure(UpdateErrorCode.IO_FAILED) }
        var total = 0L
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        try {
            while (!channel.isClosedForRead) {
                val count = channel.readAvailable(buffer)
                if (count < 0) break
                if (count == 0) continue
                total += count
                if (total > config.maxBytes) throw UpdateFailure(UpdateErrorCode.DOWNLOAD_TOO_LARGE)
                digest.update(buffer, 0, count)
                file.writeFully(ByteBuffer.wrap(buffer, 0, count), total - count)
                onProgress(total)
            }
        } catch (failure: UpdateFailure) {
            throw failure
        } catch (_: Throwable) {
            throw UpdateFailure(UpdateErrorCode.DOWNLOAD_FAILED)
        } finally {
            file.close()
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    open suspend fun downloadSmall(url: String, maxBytes: Long = 64 * 1024): ByteArray {
        val response = getFollowingRedirects(url)
        if (!response.status.isSuccess()) throw UpdateFailure(UpdateErrorCode.DOWNLOAD_FAILED)
        val channel = response.bodyAsChannel()
        val output = ArrayList<Byte>()
        val buffer = ByteArray(4096)
        while (!channel.isClosedForRead) {
            val count = channel.readAvailable(buffer)
            if (count < 0) break
            if (count == 0) continue
            if (output.size + count > maxBytes) throw UpdateFailure(UpdateErrorCode.DOWNLOAD_TOO_LARGE)
            repeat(count) { output.add(buffer[it]) }
        }
        return output.toByteArray()
    }

    private suspend fun getFollowingRedirects(initialUrl: String): HttpResponse {
        var current = initialUrl
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            val safeUrl = validateUpdateUrl(current, config.allowedHosts)
            val response = client.get(safeUrl) {
                header(HttpHeaders.Accept, "application/octet-stream")
                header(HttpHeaders.UserAgent, "orryx-editor-updater")
                if (safeUrl.host in AUTHENTICATED_GITHUB_HOSTS) {
                    config.githubToken?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                }
            }
            if (response.status.value !in 300..399) return response
            if (redirectCount == MAX_REDIRECTS) throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
            current = response.headers[HttpHeaders.Location] ?: throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
        }
        throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
    }

    private suspend fun AsynchronousFileChannel.writeFully(buffer: ByteBuffer, start: Long) {
        var position = start
        while (buffer.hasRemaining()) {
            val written = suspendCancellableCoroutine<Int> { continuation ->
                write(buffer, position, Unit, object : CompletionHandler<Int, Unit> {
                    override fun completed(result: Int, attachment: Unit) = continuation.resume(result)
                    override fun failed(error: Throwable, attachment: Unit) = continuation.resumeWithException(error)
                })
            }
            if (written <= 0) throw UpdateFailure(UpdateErrorCode.IO_FAILED)
            position += written
        }
    }

    companion object {
        private const val MAX_REDIRECTS = 5
        private val AUTHENTICATED_GITHUB_HOSTS = setOf("api.github.com", "github.com")
    }
}
