package com.orryx.editor.ai

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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.net.URI
import java.time.Duration

class OpenAiProviderConfig(
    val providerId: String,
    val baseUrl: URI,
    apiKey: String,
    val requestTimeout: Duration = Duration.ofSeconds(60),
    val maxResponseBytes: Long = 2L * 1024 * 1024
) {
    private val secret = apiKey.trim()

    init {
        require(providerId.matches(Regex("[a-z0-9][a-z0-9._-]{0,63}"))) { "providerId 无效" }
        validateAiProviderBaseUrl(baseUrl.toString())
        require(secret.isNotEmpty()) { "AI provider API key 不能为空" }
        require('\r' !in secret && '\n' !in secret) { "AI provider API key 包含非法字符" }
        require(!requestTimeout.isNegative && !requestTimeout.isZero) { "requestTimeout 必须大于 0" }
        require(maxResponseBytes in 1..16L * 1024 * 1024) { "maxResponseBytes 超出允许范围" }
    }

    internal fun authorizationHeader(): String = "Bearer $secret"

    override fun toString(): String =
        "OpenAiProviderConfig(providerId=$providerId, baseUrl=$baseUrl, apiKey=<redacted>, requestTimeout=$requestTimeout, maxResponseBytes=$maxResponseBytes)"
}

class OpenAiCompatibleProvider(
    private val client: HttpClient,
    private val config: OpenAiProviderConfig,
    private val json: Json = Json { ignoreUnknownKeys = true }
) : AiProvider {
    override val providerId: String = config.providerId

    override suspend fun execute(request: AiProviderRequest): AiProviderResult {
        require(request.model.isNotBlank()) { "model 不能为空" }
        require(request.prompt.isNotBlank()) { "prompt 不能为空" }
        val requestBody = buildRequestBody(request)
        val response = try {
            withTimeout(config.requestTimeout.toMillis()) {
                client.post(completionEndpoint(config.baseUrl)) {
                    accept(ContentType.Application.Json)
                    contentType(ContentType.Application.Json)
                    header(HttpHeaders.Authorization, config.authorizationHeader())
                    header("X-Request-ID", request.requestId)
                    setBody(requestBody.toString())
                }
            }
        } catch (failure: TimeoutCancellationException) {
            throw providerFailure(AiProviderErrorCategory.TIMEOUT, "AI_PROVIDER_TIMEOUT", true, failure)
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Throwable) {
            throw providerFailure(AiProviderErrorCategory.NETWORK, "AI_PROVIDER_NETWORK", true, failure)
        }

        if (!response.status.isSuccess()) throw statusFailure(response.status.value)
        val bytes = try {
            readLimited(response.bodyAsChannel(), config.maxResponseBytes)
        } catch (failure: AiProviderException) {
            throw failure
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Throwable) {
            throw providerFailure(AiProviderErrorCategory.NETWORK, "AI_PROVIDER_NETWORK", true, failure)
        }
        val responseBody = runCatching { json.parseToJsonElement(bytes.decodeToString()).jsonObject }
            .getOrElse {
                throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_INVALID_JSON", false, it)
            }
        return parseResponse(requestBody, responseBody)
    }

    private fun parseResponse(requestBody: JsonObject, responseBody: JsonObject): AiProviderResult {
        val choices = responseBody["choices"] as? JsonArray
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_MISSING_CHOICE", false)
        val choice = choices.firstOrNull() as? JsonObject
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_MISSING_CHOICE", false)
        val message = choice["message"] as? JsonObject
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_MISSING_CONTENT", false)
        val content = (message["content"] as? JsonPrimitive)?.contentOrNull
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_MISSING_CONTENT", false)
        val structured = runCatching { json.parseToJsonElement(content) }.getOrElse {
            throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_CONTENT_NOT_JSON", false, it)
        }
        if (structured !is JsonObject && structured !is JsonArray) {
            throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_CONTENT_NOT_STRUCTURED", false)
        }
        val usageObject = responseBody["usage"] as? JsonObject
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_MISSING_USAGE", false)
        val input = (usageObject["prompt_tokens"] as? JsonPrimitive)?.longOrNull
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_INVALID_USAGE", false)
        val output = (usageObject["completion_tokens"] as? JsonPrimitive)?.longOrNull
            ?: throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_INVALID_USAGE", false)
        val details = usageObject["prompt_tokens_details"] as? JsonObject
        val cached = (details?.get("cached_tokens") as? JsonPrimitive)?.longOrNull ?: 0L
        val total = (usageObject["total_tokens"] as? JsonPrimitive)?.longOrNull ?: input + output
        val usage = runCatching { AiProviderUsage(input, output, cached, total) }.getOrElse {
            throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_INVALID_USAGE", false, it)
        }
        return AiProviderResult(
            content = structured,
            usage = usage,
            providerRequestId = (responseBody["id"] as? JsonPrimitive)?.contentOrNull,
            requestPayload = requestBody,
            responsePayload = responseBody
        )
    }

    private fun buildRequestBody(request: AiProviderRequest): JsonObject = buildJsonObject {
        put("model", request.model)
        put("messages", buildJsonArray {
            add(buildJsonObject {
                put("role", "user")
                put("content", request.prompt)
            })
        })
        put("response_format", buildJsonObject { put("type", "json_object") })
    }

    private fun statusFailure(status: Int): AiProviderException = when (status) {
        400, 404, 422 -> providerFailure(AiProviderErrorCategory.INVALID_REQUEST, "AI_PROVIDER_INVALID_REQUEST", false)
        401, 403 -> providerFailure(AiProviderErrorCategory.AUTHENTICATION, "AI_PROVIDER_AUTHENTICATION", false)
        408 -> providerFailure(AiProviderErrorCategory.TIMEOUT, "AI_PROVIDER_TIMEOUT", true)
        409, 425, 429 -> providerFailure(AiProviderErrorCategory.RATE_LIMIT, "AI_PROVIDER_RATE_LIMIT", true)
        in 500..599 -> providerFailure(AiProviderErrorCategory.UPSTREAM, "AI_PROVIDER_UPSTREAM", true)
        else -> providerFailure(AiProviderErrorCategory.UPSTREAM, "AI_PROVIDER_HTTP_$status", false)
    }
}

fun validateAiProviderBaseUrl(raw: String): URI {
    val uri = runCatching { URI(raw.trim()) }.getOrElse { throw IllegalArgumentException("AI provider base URL 无效") }
    require(uri.isAbsolute && uri.host != null) { "AI provider base URL 必须是绝对 URI" }
    require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "AI provider base URL 不允许凭据、查询或片段" }
    val scheme = uri.scheme.lowercase()
    val loopback = isLoopbackHost(uri.host)
    require(scheme == "https" || (scheme == "http" && loopback)) {
        "AI provider base URL 仅允许 HTTPS 或显式 loopback HTTP"
    }
    return uri.normalize()
}

private fun completionEndpoint(baseUrl: URI): String = baseUrl.toString().trimEnd('/') + "/chat/completions"

private fun isLoopbackHost(rawHost: String): Boolean {
    val host = rawHost.lowercase().removePrefix("[").removeSuffix("]").substringBefore('%')
    if (host == "localhost" || host == "::1" || host == "0:0:0:0:0:0:0:1") return true
    val octets = host.split('.').mapNotNull(String::toIntOrNull)
    return octets.size == 4 && octets.all { it in 0..255 } && octets.first() == 127
}

private suspend fun readLimited(channel: io.ktor.utils.io.ByteReadChannel, maxBytes: Long): ByteArray {
    val output = ByteArrayOutputStream(minOf(maxBytes, 64L * 1024).toInt())
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0L
    while (!channel.isClosedForRead) {
        val count = channel.readAvailable(buffer)
        if (count < 0) break
        if (count == 0) continue
        total += count
        if (total > maxBytes) {
            throw providerFailure(AiProviderErrorCategory.INVALID_RESPONSE, "AI_PROVIDER_RESPONSE_TOO_LARGE", false)
        }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

private fun providerFailure(
    category: AiProviderErrorCategory,
    code: String,
    retryable: Boolean,
    cause: Throwable? = null
): AiProviderException = AiProviderException(AiProviderError(category, code, retryable), cause)
