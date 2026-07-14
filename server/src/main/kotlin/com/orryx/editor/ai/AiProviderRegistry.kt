package com.orryx.editor.ai

data class AiProviderRegistration(
    val providerId: String,
    val enabled: Boolean,
    val models: Set<String>,
    val defaultModel: String
) {
    init {
        require(providerId.matches(PROVIDER_ID_PATTERN)) { "providerId 无效" }
        require(models.isNotEmpty()) { "provider 至少需要一个 model" }
        require(models.all { it.isNotBlank() && it.length <= 128 }) { "model 无效" }
        require(defaultModel in models) { "defaultModel 必须存在于 models" }
    }

    private companion object {
        val PROVIDER_ID_PATTERN = Regex("[a-z0-9][a-z0-9._-]{0,63}")
    }
}

data class ResolvedAiProvider(val provider: AiProvider, val providerId: String, val model: String)

class AiProviderRegistry(
    providers: Collection<AiProvider>,
    registrations: Collection<AiProviderRegistration>
) {
    private val providersById: Map<String, AiProvider>
    private val registrationsById: Map<String, AiProviderRegistration>

    init {
        require(providers.isNotEmpty()) { "至少需要一个 AI provider" }
        require(registrations.isNotEmpty()) { "至少需要一个 AI provider 配置" }
        require(providers.map(AiProvider::providerId).distinct().size == providers.size) { "providerId 重复" }
        require(registrations.map(AiProviderRegistration::providerId).distinct().size == registrations.size) {
            "provider 配置重复"
        }
        providersById = providers.associateBy(AiProvider::providerId)
        registrationsById = registrations.associateBy(AiProviderRegistration::providerId)
        require(providersById.keys == registrationsById.keys) { "provider 实例与配置不一致" }
    }

    fun resolve(providerId: String, model: String? = null): ResolvedAiProvider {
        val registration = registrationsById[providerId] ?: throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.CONFIGURATION, "AI_PROVIDER_NOT_FOUND", false)
        )
        if (!registration.enabled) throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.DISABLED, "AI_PROVIDER_DISABLED", false)
        )
        val resolvedModel = model?.takeIf(String::isNotBlank) ?: registration.defaultModel
        if (resolvedModel !in registration.models) throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.CONFIGURATION, "AI_MODEL_NOT_ALLOWED", false)
        )
        val provider = providersById.getValue(providerId)
        check(provider.providerId == providerId) { "providerId 在运行期发生变化" }
        return ResolvedAiProvider(provider, providerId, resolvedModel)
    }

    fun registration(providerId: String): AiProviderRegistration? = registrationsById[providerId]
}
