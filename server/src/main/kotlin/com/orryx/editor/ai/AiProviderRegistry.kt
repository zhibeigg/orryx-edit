package com.orryx.editor.ai

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

data class AiProviderRegistration(
    val providerId: String,
    val enabled: Boolean,
    val models: Set<String>,
    val defaultModel: String,
    val pricing: Map<String, ModelTokenPricing> = models.associateWith { ModelTokenPricing(0, 0) }
) {
    init {
        require(providerId.matches(PROVIDER_ID_PATTERN)) { "providerId 无效" }
        require(models.isNotEmpty()) { "provider 至少需要一个 model" }
        require(models.all { it.isNotBlank() && it.length <= 128 }) { "model 无效" }
        require(defaultModel in models) { "defaultModel 必须存在于 models" }
        require(pricing.keys == models) { "pricing 必须覆盖且只能包含允许的 models" }
    }

    private companion object {
        val PROVIDER_ID_PATTERN = Regex("[a-z0-9][a-z0-9._-]{0,63}")
    }
}

data class ResolvedAiProvider(val provider: AiProvider, val providerId: String, val model: String)

class AiProviderRegistry(
    providers: Collection<AiProvider> = emptyList(),
    registrations: Collection<AiProviderRegistration> = emptyList()
) {
    private val providersById = ConcurrentHashMap<String, AiProvider>()
    private val registrationsRef = AtomicReference<Map<String, AiProviderRegistration>>(emptyMap())

    init {
        require(providers.map(AiProvider::providerId).distinct().size == providers.size) { "providerId 重复" }
        providers.forEach(::registerProvider)
        replaceRegistrations(registrations)
    }

    fun registerProvider(provider: AiProvider) {
        require(provider.providerId.matches(Regex("[a-z0-9][a-z0-9._-]{0,63}"))) { "providerId 无效" }
        providersById[provider.providerId] = provider
    }

    fun unregisterProvider(providerId: String): AiProvider? = providersById.remove(providerId)

    fun replaceRegistrations(registrations: Collection<AiProviderRegistration>) {
        require(registrations.map(AiProviderRegistration::providerId).distinct().size == registrations.size) {
            "provider 配置重复"
        }
        registrationsRef.set(registrations.associateBy(AiProviderRegistration::providerId))
    }

    fun upsertRegistration(registration: AiProviderRegistration) {
        while (true) {
            val current = registrationsRef.get()
            val updated = current + (registration.providerId to registration)
            if (registrationsRef.compareAndSet(current, updated)) return
        }
    }

    fun resolve(providerId: String, model: String? = null): ResolvedAiProvider {
        val registration = registrationsRef.get()[providerId] ?: throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.CONFIGURATION, "AI_PROVIDER_NOT_FOUND", false)
        )
        if (!registration.enabled) throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.DISABLED, "AI_PROVIDER_DISABLED", false)
        )
        val resolvedModel = model?.takeIf(String::isNotBlank) ?: registration.defaultModel
        if (resolvedModel !in registration.models) throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.CONFIGURATION, "AI_MODEL_NOT_ALLOWED", false)
        )
        val provider = providersById[providerId] ?: throw AiProviderException(
            AiProviderError(AiProviderErrorCategory.CONFIGURATION, "AI_PROVIDER_RUNTIME_UNAVAILABLE", false)
        )
        check(provider.providerId == providerId) { "providerId 在运行期发生变化" }
        return ResolvedAiProvider(provider, providerId, resolvedModel)
    }

    fun registration(providerId: String): AiProviderRegistration? = registrationsRef.get()[providerId]

    fun registrations(): List<AiProviderRegistration> = registrationsRef.get().values.sortedBy(AiProviderRegistration::providerId)

    fun pricing(providerId: String, model: String): ModelTokenPricing? = registration(providerId)?.pricing?.get(model)

    fun hasRuntimeProvider(providerId: String): Boolean = providersById.containsKey(providerId)
}
