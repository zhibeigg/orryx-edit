package com.orryx.editor.ketherdocs

import io.ktor.client.HttpClient
import io.ktor.client.request.accept
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.net.URI

internal interface KetherDocsUpstream {
    suspend fun fetchLatest(): FetchedKetherDocs
}

internal open class KetherDocsRemoteClient(
    private val client: HttpClient,
    private val config: KetherDocsConfig,
    private val validator: KetherDocsValidator
) : KetherDocsUpstream {

    override suspend fun fetchLatest(): FetchedKetherDocs {
        val channelBytes = downloadJson(
            uri = validator.channelUri,
            maxBytes = config.maxChannelBytes,
            unavailableCode = KetherDocsErrorCode.CHANNEL_UNAVAILABLE,
            invalidCode = KetherDocsErrorCode.CHANNEL_INVALID,
            tooLargeCode = KetherDocsErrorCode.CHANNEL_INVALID
        )
        val pointer = validator.parseChannel(channelBytes)
        val manifestUri = validator.resolveManifestUri(pointer)
        val manifestBytes = downloadJson(
            uri = manifestUri,
            maxBytes = config.maxManifestBytes,
            unavailableCode = KetherDocsErrorCode.MANIFEST_UNAVAILABLE,
            invalidCode = KetherDocsErrorCode.MANIFEST_INVALID,
            tooLargeCode = KetherDocsErrorCode.MANIFEST_INVALID
        )
        val manifest = validator.parseReleaseManifest(manifestBytes, pointer)
        val schemaUri = validator.resolveSchemaUri(manifestUri, manifest)
        val schemaBytes = downloadJson(
            uri = schemaUri,
            maxBytes = minOf(config.maxSchemaBytes, manifest.schema.bytes),
            unavailableCode = KetherDocsErrorCode.SCHEMA_UNAVAILABLE,
            invalidCode = KetherDocsErrorCode.SCHEMA_INVALID,
            tooLargeCode = KetherDocsErrorCode.SCHEMA_TOO_LARGE
        )
        return validator.validateRemoteSchema(schemaBytes, pointer, manifest)
    }

    private suspend fun downloadJson(
        uri: URI,
        maxBytes: Long,
        unavailableCode: String,
        invalidCode: String,
        tooLargeCode: String
    ): ByteArray = try {
        withTimeout(config.requestTimeout.toMillis()) {
            val response = client.get(uri.toString()) {
                accept(ContentType.Application.Json)
                header(HttpHeaders.UserAgent, "orryx-editor-kether-docs/${config.channel}")
            }
            if (response.status.value in 300..399) throw KetherDocsFailure(KetherDocsErrorCode.URL_REJECTED)
            if (!response.status.isSuccess()) throw KetherDocsFailure(unavailableCode)
            val contentType = response.headers[HttpHeaders.ContentType]?.let { runCatching { ContentType.parse(it) }.getOrNull() }
            if (contentType?.match(ContentType.Application.Json) != true) throw KetherDocsFailure(invalidCode)
            response.headers[HttpHeaders.ContentLength]?.toLongOrNull()?.let { length ->
                if (length !in 0..maxBytes) throw KetherDocsFailure(tooLargeCode)
            }

            val output = ByteArrayOutputStream(minOf(maxBytes, 64L * 1024).toInt())
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (!channel.isClosedForRead) {
                val count = channel.readAvailable(buffer)
                if (count < 0) break
                if (count == 0) continue
                total += count
                if (total > maxBytes) throw KetherDocsFailure(tooLargeCode)
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    } catch (failure: KetherDocsFailure) {
        throw failure
    } catch (_: TimeoutCancellationException) {
        throw KetherDocsFailure(unavailableCode)
    } catch (failure: CancellationException) {
        throw failure
    } catch (_: Throwable) {
        throw KetherDocsFailure(unavailableCode)
    }
}
