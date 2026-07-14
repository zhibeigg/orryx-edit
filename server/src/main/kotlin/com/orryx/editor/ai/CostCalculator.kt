package com.orryx.editor.ai

import java.math.BigInteger

data class ProviderModelKey(val providerId: String, val model: String)

data class ModelTokenPricing(
    val inputCentsPerMillion: Long,
    val outputCentsPerMillion: Long,
    val cachedInputCentsPerMillion: Long = inputCentsPerMillion
) {
    init {
        require(inputCentsPerMillion >= 0) { "input 单价不能为负数" }
        require(outputCentsPerMillion >= 0) { "output 单价不能为负数" }
        require(cachedInputCentsPerMillion >= 0) { "cached input 单价不能为负数" }
    }
}

fun interface CostCalculator {
    fun calculate(providerId: String, model: String, usage: AiProviderUsage): Long
}

class FixedRateCostCalculator(private val pricing: Map<ProviderModelKey, ModelTokenPricing>) : CostCalculator {
    init {
        require(pricing.isNotEmpty()) { "至少需要一项模型价格" }
    }

    override fun calculate(providerId: String, model: String, usage: AiProviderUsage): Long {
        val rate = pricing[ProviderModelKey(providerId, model)]
            ?: throw AiJobException(AiJobErrorCode.BILLING_FAILED, "模型价格未配置")
        val regularInput = usage.inputTokens - usage.cachedInputTokens
        val numerator = regularInput.toBigInteger() * rate.inputCentsPerMillion.toBigInteger() +
            usage.cachedInputTokens.toBigInteger() * rate.cachedInputCentsPerMillion.toBigInteger() +
            usage.outputTokens.toBigInteger() * rate.outputCentsPerMillion.toBigInteger()
        if (numerator == BigInteger.ZERO) return 0
        val cents = numerator.add(TOKENS_PER_MILLION - BigInteger.ONE).divide(TOKENS_PER_MILLION)
        return runCatching { cents.longValueExact() }
            .getOrElse { throw AiJobException(AiJobErrorCode.BILLING_FAILED, "AI 成本溢出") }
    }

    private companion object {
        val TOKENS_PER_MILLION: BigInteger = BigInteger.valueOf(1_000_000L)
    }
}
