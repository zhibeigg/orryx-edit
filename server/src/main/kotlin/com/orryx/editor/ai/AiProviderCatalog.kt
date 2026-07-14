package com.orryx.editor.ai

import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
data class AiProviderModel(
    val id: String,
    val inputCentsPerMillion: Long,
    val outputCentsPerMillion: Long,
    val cachedInputCentsPerMillion: Long = inputCentsPerMillion
) {
    init {
        require(id.isNotBlank() && id.length <= 128) { "model id 无效" }
        require(inputCentsPerMillion >= 0) { "input price 不能为负数" }
        require(outputCentsPerMillion >= 0) { "output price 不能为负数" }
        require(cachedInputCentsPerMillion >= 0) { "cached input price 不能为负数" }
    }

    fun pricing(): ModelTokenPricing = ModelTokenPricing(
        inputCentsPerMillion = inputCentsPerMillion,
        outputCentsPerMillion = outputCentsPerMillion,
        cachedInputCentsPerMillion = cachedInputCentsPerMillion
    )
}

data class AiProviderCatalogEntry(
    val providerId: String,
    val providerType: String,
    val displayName: String,
    val baseUrl: String,
    val defaultModel: String,
    val enabled: Boolean,
    val models: List<AiProviderModel>,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    init {
        require(providerId.matches(Regex("[a-z0-9][a-z0-9._-]{0,63}"))) { "providerId 无效" }
        require(providerType.isNotBlank() && providerType.length <= 32) { "providerType 无效" }
        require(displayName.isNotBlank() && displayName.length <= 100) { "displayName 无效" }
        require(baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        require(models.isNotEmpty()) { "models 不能为空" }
        require(models.map(AiProviderModel::id).distinct().size == models.size) { "model id 重复" }
        require(defaultModel in models.map(AiProviderModel::id)) { "defaultModel 必须存在于 models" }
    }

    fun registration(): AiProviderRegistration = AiProviderRegistration(
        providerId = providerId,
        enabled = enabled,
        models = models.map(AiProviderModel::id).toSet(),
        defaultModel = defaultModel,
        pricing = models.associate { it.id to it.pricing() }
    )
}

data class UpdateAiProviderCatalogCommand(
    val enabled: Boolean,
    val displayName: String,
    val defaultModel: String,
    val models: List<AiProviderModel>,
    val requestedProviderType: String? = null,
    val requestedBaseUrl: String? = null,
    val now: Instant = Instant.now()
)

data class AiProviderCatalogUpdateResult(
    val provider: AiProviderCatalogEntry,
    val restartRequired: Boolean
)

interface AiProviderCatalogRepository {
    suspend fun list(): List<AiProviderCatalogEntry>
    suspend fun find(providerId: String): AiProviderCatalogEntry?
    suspend fun updateDynamic(providerId: String, command: UpdateAiProviderCatalogCommand): AiProviderCatalogEntry?
}

class AiProviderCatalogService(
    private val repository: AiProviderCatalogRepository,
    private val registry: AiProviderRegistry
) {
    suspend fun initialize(): List<AiProviderCatalogEntry> = repository.list().also { entries ->
        registry.replaceRegistrations(entries.map(AiProviderCatalogEntry::registration))
    }

    suspend fun listEnabled(): List<AiProviderCatalogEntry> = repository.list().filter(AiProviderCatalogEntry::enabled)

    suspend fun listAdmin(): List<AiProviderCatalogEntry> = repository.list()

    suspend fun get(providerId: String): AiProviderCatalogEntry? = repository.find(providerId)

    suspend fun update(providerId: String, command: UpdateAiProviderCatalogCommand): AiProviderCatalogUpdateResult? {
        require(command.displayName.trim().length in 1..100) { "displayName 长度必须在 1..100" }
        require(command.models.isNotEmpty()) { "models 不能为空" }
        require(command.models.size <= 100) { "models 不能超过 100 项" }
        require(command.models.map(AiProviderModel::id).distinct().size == command.models.size) { "model id 重复" }
        require(command.defaultModel in command.models.map(AiProviderModel::id)) { "defaultModel 必须存在于 models" }
        val current = repository.find(providerId) ?: return null
        if (command.enabled) require(registry.hasRuntimeProvider(providerId)) { "AI_PROVIDER_RUNTIME_UNAVAILABLE" }
        val updated = repository.updateDynamic(
            providerId,
            command.copy(displayName = command.displayName.trim())
        ) ?: return null
        registry.upsertRegistration(updated.registration())
        return AiProviderCatalogUpdateResult(
            provider = updated,
            restartRequired = command.requestedProviderType?.let { it != current.providerType } == true ||
                command.requestedBaseUrl?.let { it != current.baseUrl } == true
        )
    }
}

class RegistryCostCalculator(private val registry: AiProviderRegistry) : CostCalculator {
    override fun calculate(providerId: String, model: String, usage: AiProviderUsage): Long {
        val pricing = registry.pricing(providerId, model)
            ?: throw AiJobException(AiJobErrorCode.BILLING_FAILED, "模型价格未配置")
        return FixedRateCostCalculator(mapOf(ProviderModelKey(providerId, model) to pricing))
            .calculate(providerId, model, usage)
    }
}
