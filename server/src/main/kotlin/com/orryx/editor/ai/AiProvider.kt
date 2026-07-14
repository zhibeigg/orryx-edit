package com.orryx.editor.ai

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

interface AiProvider {
    val providerId: String

    suspend fun execute(request: AiProviderRequest): AiProviderResult
}

@Serializable
data class AiProviderRequest(
    val requestId: String,
    val model: String,
    val operation: AiOperation,
    val prompt: String
)

@Serializable
data class AiProviderResult(
    val content: JsonElement,
    val usage: AiProviderUsage,
    val providerRequestId: String? = null,
    val requestPayload: JsonElement? = null,
    val responsePayload: JsonElement? = null
)

@Serializable
data class AiProviderUsage(
    val inputTokens: Long,
    val outputTokens: Long,
    val cachedInputTokens: Long = 0,
    val totalTokens: Long = inputTokens + outputTokens
) {
    init {
        require(inputTokens >= 0) { "inputTokens 不能为负数" }
        require(outputTokens >= 0) { "outputTokens 不能为负数" }
        require(cachedInputTokens in 0..inputTokens) { "cachedInputTokens 必须位于 inputTokens 范围内" }
        require(totalTokens >= inputTokens + outputTokens) { "totalTokens 不能小于输入与输出 token 之和" }
    }
}

@Serializable
enum class AiProviderErrorCategory {
    CONFIGURATION,
    AUTHENTICATION,
    INVALID_REQUEST,
    RATE_LIMIT,
    TIMEOUT,
    NETWORK,
    UPSTREAM,
    INVALID_RESPONSE,
    DISABLED
}

@Serializable
data class AiProviderError(
    val category: AiProviderErrorCategory,
    val code: String,
    val retryable: Boolean,
    val message: String? = null
)

class AiProviderException(val error: AiProviderError, cause: Throwable? = null) : RuntimeException(error.code, cause)
