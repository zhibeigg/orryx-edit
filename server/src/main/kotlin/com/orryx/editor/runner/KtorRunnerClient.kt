package com.orryx.editor.runner

import io.ktor.client.HttpClient
import io.ktor.client.request.accept
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayOutputStream
import java.net.URI
import java.time.Duration

class RunnerClientConfig(
    val endpoint: URI,
    sharedSecret: String,
    val requestTimeout: Duration = Duration.ofSeconds(30),
    val maxResponseBytes: Long = 2L * 1024 * 1024,
    val allowedPrivateBaseUris: Set<URI> = emptySet()
) {
    private val secret = sharedSecret.trim()
    internal val validatedEndpoint: URI = validateRunnerEndpoint(endpoint, allowedPrivateBaseUris)

    init {
        require(secret.length >= 16) { "Runner shared secret 长度不足" }
        require('\r' !in secret && '\n' !in secret) { "Runner shared secret 包含非法字符" }
        require(!requestTimeout.isNegative && !requestTimeout.isZero) { "requestTimeout 必须大于 0" }
        require(maxResponseBytes in 1..16L * 1024 * 1024) { "maxResponseBytes 超出允许范围" }
    }

    internal fun authorizationHeader(): String = "Bearer $secret"

    override fun toString(): String =
        "RunnerClientConfig(endpoint=$endpoint, sharedSecret=<redacted>, requestTimeout=$requestTimeout, maxResponseBytes=$maxResponseBytes, allowedPrivateBaseUris=$allowedPrivateBaseUris)"
}

class KtorRunnerClient(
    private val client: HttpClient,
    private val config: RunnerClientConfig,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
) : RunnerClient {
    override suspend fun execute(request: RunnerRequest): RunnerResult {
        require(request.requestId.isNotBlank() && request.requestId.length <= 128) { "requestId 无效" }
        RunnerPayloadGuard.requireSafe(request.payload)
        val envelope = ServiceRunnerEnvelope(
            requestId = request.requestId,
            operation = request.operation,
            payload = request.payload
        )
        val requestElement = json.encodeToJsonElement(envelope).jsonObject
        val response = try {
            withTimeout(config.requestTimeout.toMillis()) {
                client.post(config.validatedEndpoint.toString()) {
                    accept(ContentType.Application.Json)
                    contentType(ContentType.Application.Json)
                    header(HttpHeaders.Authorization, config.authorizationHeader())
                    header("X-Request-ID", request.requestId)
                    setBody(requestElement.toString())
                }
            }
        } catch (failure: TimeoutCancellationException) {
            throw runnerFailure("RUNNER_TIMEOUT", true, failure)
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Throwable) {
            throw runnerFailure("RUNNER_NETWORK", true, failure)
        }
        if (response.status.value in 300..399) throw runnerFailure("RUNNER_REDIRECT_REJECTED", false)
        if (!response.status.isSuccess()) throw runnerFailure("RUNNER_HTTP_${response.status.value}", response.status.value >= 500)
        val body = try {
            readRunnerBody(response.bodyAsChannel(), config.maxResponseBytes)
        } catch (failure: RunnerException) {
            throw failure
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Throwable) {
            throw runnerFailure("RUNNER_NETWORK", true, failure)
        }
        val responseElement = runCatching { json.parseToJsonElement(body.decodeToString()).jsonObject }
            .getOrElse { throw runnerFailure("RUNNER_INVALID_JSON", false, it) }
        val responseRequestId = responseElement["requestId"]?.jsonPrimitive?.contentOrNull
            ?: throw runnerFailure("RUNNER_MISSING_REQUEST_ID", false)
        if (responseRequestId != request.requestId) throw runnerFailure("RUNNER_REQUEST_ID_MISMATCH", false)
        val error = responseElement["error"] as? JsonObject
        if (error != null) {
            val code = error["code"]?.jsonPrimitive?.contentOrNull ?: "RUNNER_FAILED"
            val message = error["message"]?.jsonPrimitive?.contentOrNull
            val retryable = error["retryable"]?.jsonPrimitive?.booleanOrNull ?: false
            throw RunnerException(RunnerError(code, message, retryable))
        }
        if (responseElement["ok"]?.jsonPrimitive?.booleanOrNull == false) throw runnerFailure("RUNNER_FAILED", false)
        val status = responseElement["status"]?.jsonPrimitive?.contentOrNull?.uppercase()
        if (status == "FAILED") throw runnerFailure("RUNNER_FAILED", false)
        val result = responseElement["result"] ?: responseElement["payload"]
            ?: throw runnerFailure("RUNNER_MISSING_RESULT", false)
        RunnerPayloadGuard.requireSafe(result)
        return RunnerResult(request.requestId, result, requestElement, responseElement)
    }
}

fun validateRunnerEndpoint(endpoint: URI, allowedPrivateBaseUris: Set<URI> = emptySet()): URI {
    val normalized = normalizeRunnerUri(endpoint)
    if (isRunnerLoopback(normalized.host)) return normalized
    val allowed = allowedPrivateBaseUris.map { configured ->
        normalizeRunnerUri(configured).also { base ->
            require(isConfiguredPrivateHost(base.host)) { "allowedPrivateBaseUris 只能包含私网 URI" }
        }
    }
    require(allowed.any { base -> normalized.isUnder(base) }) {
        "Runner endpoint 仅允许 loopback 或配置的私网 URI"
    }
    return normalized
}

private fun normalizeRunnerUri(uri: URI): URI {
    require(uri.isAbsolute && uri.host != null) { "Runner URI 必须是绝对 URI" }
    require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) { "Runner URI 仅允许 HTTP(S)" }
    require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "Runner URI 不允许凭据、查询或片段" }
    return uri.normalize()
}

private fun URI.isUnder(base: URI): Boolean {
    if (!scheme.equals(base.scheme, true) || !host.equals(base.host, true) || effectivePort() != base.effectivePort()) return false
    val basePath = base.path.ifEmpty { "/" }.trimEnd('/')
    val targetPath = path.ifEmpty { "/" }
    return targetPath == basePath || targetPath.startsWith("$basePath/") || basePath == "/"
}

private fun URI.effectivePort(): Int = when {
    port >= 0 -> port
    scheme.equals("https", true) -> 443
    else -> 80
}

private fun isRunnerLoopback(rawHost: String): Boolean {
    val host = normalizedRunnerHost(rawHost)
    if (host == "localhost" || host == "::1" || host == "0:0:0:0:0:0:0:1") return true
    val octets = host.ipv4Octets() ?: return false
    return octets.first() == 127
}

private fun isConfiguredPrivateHost(rawHost: String): Boolean {
    val host = normalizedRunnerHost(rawHost)
    if (isRunnerLoopback(host)) return true
    val octets = host.ipv4Octets()
    if (octets != null) {
        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254)
    }
    if (':' in host) {
        return host.startsWith("fc") || host.startsWith("fd") ||
            host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")
    }
    return '.' !in host || host.endsWith(".internal") || host.endsWith(".local")
}

private fun normalizedRunnerHost(rawHost: String): String =
    rawHost.lowercase().removePrefix("[").removeSuffix("]").substringBefore('%')

private fun String.ipv4Octets(): List<Int>? {
    val octets = split('.').mapNotNull(String::toIntOrNull)
    return octets.takeIf { it.size == 4 && it.all { value -> value in 0..255 } }
}

private suspend fun readRunnerBody(channel: io.ktor.utils.io.ByteReadChannel, maxBytes: Long): ByteArray {
    val output = ByteArrayOutputStream(minOf(maxBytes, 64L * 1024).toInt())
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0L
    while (!channel.isClosedForRead) {
        val count = channel.readAvailable(buffer)
        if (count < 0) break
        if (count == 0) continue
        total += count
        if (total > maxBytes) throw runnerFailure("RUNNER_RESPONSE_TOO_LARGE", false)
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

private fun runnerFailure(code: String, retryable: Boolean, cause: Throwable? = null): RunnerException =
    RunnerException(RunnerError(code, retryable = retryable), cause)
