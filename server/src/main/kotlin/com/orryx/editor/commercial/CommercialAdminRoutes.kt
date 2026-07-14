package com.orryx.editor.commercial

import com.orryx.editor.ai.AiJob
import com.orryx.editor.ai.AiJobQuery
import com.orryx.editor.ai.AiJobStatus
import com.orryx.editor.ai.AiProviderCatalogEntry
import com.orryx.editor.ai.AiProviderModel
import com.orryx.editor.ai.UpdateAiProviderCatalogCommand
import com.orryx.editor.payment.PaymentOrder
import com.orryx.editor.payment.PaymentOrderStatus
import com.orryx.editor.plugins.ApiError
import com.orryx.editor.release.PluginReleaseTransaction
import com.orryx.editor.release.ReleaseTransactionStatus
import com.orryx.editor.release.SignedRelease
import com.orryx.editor.wallet.WalletBalance
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.serialization.Serializable
import java.util.UUID

fun Route.commercialAdminRoutes(
    services: CommercialServices,
    authorized: suspend (ApplicationCall) -> Boolean
) {
    if (!services.features.accountsEnabled) return

    services.aiProviders?.takeIf { services.features.aiWorkbenchEnabled }?.let { catalog ->
        get("/ai/providers") {
            if (!authorized(call)) return@get
            call.respond(AdminAiProvidersResponse(catalog.listAdmin().map { it.toAdminResponse(false) }))
        }
        get("/ai/providers/{id}") {
            if (!authorized(call)) return@get
            val providerId = call.parameters["id"]?.takeIf { PROVIDER_ID.matches(it) } ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_PROVIDER_ID", "provider id 无效"))
                return@get
            }
            val provider = catalog.get(providerId)
            if (provider == null) call.respond(HttpStatusCode.NotFound, ApiError("AI_PROVIDER_NOT_FOUND", "AI Provider 不存在"))
            else call.respond(provider.toAdminResponse(false))
        }
        put("/ai/providers/{id}") {
            if (!authorized(call)) return@put
            val providerId = call.parameters["id"]?.takeIf { PROVIDER_ID.matches(it) } ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_PROVIDER_ID", "provider id 无效"))
                return@put
            }
            val input = call.receive<AdminAiProviderUpdateInput>()
            val models = input.models ?: input.config?.models ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("AI_PROVIDER_MODELS_REQUIRED", "必须提供 models"))
                return@put
            }
            val result = try {
                catalog.update(
                    providerId,
                    UpdateAiProviderCatalogCommand(
                        enabled = input.enabled,
                        displayName = input.displayName,
                        defaultModel = input.defaultModel,
                        models = models.map(AdminAiProviderModelInput::toModel),
                        requestedProviderType = input.providerType,
                        requestedBaseUrl = input.baseUrl
                    )
                )
            } catch (failure: IllegalArgumentException) {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_AI_PROVIDER", failure.message ?: "AI Provider 配置无效"))
                return@put
            }
            if (result == null) call.respond(HttpStatusCode.NotFound, ApiError("AI_PROVIDER_NOT_FOUND", "AI Provider 不存在"))
            else call.respond(result.provider.toAdminResponse(result.restartRequired))
        }
    }

    get("/commercial/orders") {
        if (!authorized(call)) return@get
        val limit = call.adminLimit() ?: return@get
        val status = call.adminEnum<PaymentOrderStatus>("status") ?: if (call.request.queryParameters["status"] != null) return@get else null
        val orders = services.paymentStore?.listOrders(status = status, limit = limit).orEmpty()
        call.respond(AdminOrdersResponse(orders.map(PaymentOrder::toAdminResponse)))
    }

    get("/commercial/wallets") {
        if (!authorized(call)) return@get
        val limit = call.adminLimit() ?: return@get
        val status = call.request.queryParameters["status"]?.uppercase()
        if (status != null && status !in setOf("FUNDED", "EMPTY")) {
            call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_STATUS", "status 必须是 FUNDED 或 EMPTY"))
            return@get
        }
        val wallets = services.wallets.listWallets(100)
            .asSequence()
            .filter { status == null || (status == "FUNDED") == (it.availableCents > 0) }
            .take(limit)
            .map(WalletBalance::toAdminResponse)
            .toList()
        call.respond(AdminWalletsResponse(wallets))
    }

    if (services.features.aiWorkbenchEnabled && services.aiJobRepository != null) {
        get("/commercial/ai/jobs") {
            if (!authorized(call)) return@get
            val limit = call.adminLimit() ?: return@get
            val status = call.adminEnum<AiJobStatus>("status") ?: if (call.request.queryParameters["status"] != null) return@get else null
            val accountId = call.adminUuid("accountId") ?: if (call.request.queryParameters["accountId"] != null) return@get else null
            val serverInstanceId = call.adminUuid("serverInstanceId") ?: if (call.request.queryParameters["serverInstanceId"] != null) return@get else null
            val jobs = services.aiJobRepository.list(
                AiJobQuery(accountId = accountId, serverInstanceId = serverInstanceId, status = status, limit = limit)
            )
            call.respond(AdminAiJobsResponse(jobs.map(AiJob::toAdminResponse)))
        }
    }

    services.releases?.repository?.let { repository ->
        get("/commercial/releases") {
            if (!authorized(call)) return@get
            val limit = call.adminLimit() ?: return@get
            val status = call.adminEnum<ReleaseTransactionStatus>("status")
                ?: if (call.request.queryParameters["status"] != null) return@get else null
            val accountId = call.adminUuid("accountId")?.toString()
                ?: if (call.request.queryParameters["accountId"] != null) return@get else null
            val serverInstanceId = call.adminUuid("serverInstanceId")?.toString()
                ?: if (call.request.queryParameters["serverInstanceId"] != null) return@get else null
            val transactions = repository.listTransactions(accountId, serverInstanceId, status, 100)
            val allowedReleaseIds = transactions.map(PluginReleaseTransaction::releaseId).toSet()
            val releases = repository.listReleases(accountId, serverInstanceId, null, 100)
                .asSequence()
                .filter { status == null || it.id in allowedReleaseIds }
                .take(limit)
                .map { release ->
                    release.toAdminResponse(transactions.firstOrNull { it.releaseId == release.id })
                }
                .toList()
            call.respond(AdminReleasesResponse(releases))
        }
    }
}

private suspend fun ApplicationCall.adminLimit(): Int? {
    val raw = request.queryParameters["limit"] ?: return 100
    val limit = raw.toIntOrNull()?.takeIf { it in 1..100 }
    if (limit == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_LIMIT", "limit 必须在 1..100 范围内"))
    return limit
}

private suspend inline fun <reified T : Enum<T>> ApplicationCall.adminEnum(name: String): T? {
    val raw = request.queryParameters[name] ?: return null
    val value = enumValues<T>().firstOrNull { it.name == raw.uppercase() }
    if (value == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_STATUS", "$name 无效"))
    return value
}

private suspend fun ApplicationCall.adminUuid(name: String): UUID? {
    val raw = request.queryParameters[name] ?: return null
    val value = runCatching { UUID.fromString(raw) }.getOrNull()
    if (value == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_ID", "$name 无效"))
    return value
}

private fun AiProviderCatalogEntry.toAdminResponse(restartRequired: Boolean) = AdminAiProviderResponse(
    id = providerId,
    providerType = providerType,
    baseUrl = baseUrl,
    displayName = displayName,
    enabled = enabled,
    defaultModel = defaultModel,
    models = models.map { AdminAiProviderModelResponse(it.id, it.inputCentsPerMillion, it.outputCentsPerMillion, it.cachedInputCentsPerMillion) },
    restartRequired = restartRequired,
    updatedAt = updatedAt.toString()
)

private fun AdminAiProviderModelInput.toModel() = AiProviderModel(
    id = id,
    inputCentsPerMillion = inputCentsPerMillion,
    outputCentsPerMillion = outputCentsPerMillion,
    cachedInputCentsPerMillion = cachedInputCentsPerMillion ?: inputCentsPerMillion
)

private fun PaymentOrder.toAdminResponse() = AdminOrderResponse(
    id, merchantOrderNo, accountId, productId.name, provider.name, amountCents, giftCents,
    status.name, providerTransactionId, createdAt.toString(), paidAt?.toString()
)

private fun WalletBalance.toAdminResponse() = AdminWalletResponse(accountId, giftCents, cashCents, availableCents)

private fun AiJob.toAdminResponse() = AdminAiJobResponse(
    id.toString(), accountId.toString(), serverInstanceId.toString(), draftId?.toString(), status.name,
    operation.name, providerId, model, usage?.inputTokens, usage?.outputTokens, costAmount,
    errorCode, createdAt.toString(), updatedAt.toString(), finishedAt?.toString()
)

private fun SignedRelease.toAdminResponse(transaction: PluginReleaseTransaction?) = AdminReleaseResponse(
    id.toString(), accountId, serverInstanceId, draftId.toString(), draftVersionId.toString(),
    draftVersionNumber, expectedBaseManifestRevision, targetManifestRevision, keyId,
    transaction?.id?.toString(), transaction?.status?.name, createdAt.toString()
)

private val PROVIDER_ID = Regex("[a-z0-9][a-z0-9._-]{0,63}")

@Serializable private data class AdminAiProvidersResponse(val providers: List<AdminAiProviderResponse>)
@Serializable private data class AdminAiProviderResponse(
    val id: String,
    val providerType: String,
    val baseUrl: String,
    val displayName: String,
    val enabled: Boolean,
    val defaultModel: String,
    val models: List<AdminAiProviderModelResponse>,
    val restartRequired: Boolean,
    val updatedAt: String
)
@Serializable private data class AdminAiProviderModelResponse(
    val id: String,
    val inputCentsPerMillion: Long,
    val outputCentsPerMillion: Long,
    val cachedInputCentsPerMillion: Long
)
@Serializable private data class AdminAiProviderUpdateInput(
    val enabled: Boolean,
    val displayName: String,
    val defaultModel: String,
    val models: List<AdminAiProviderModelInput>? = null,
    val config: AdminAiProviderConfigInput? = null,
    val providerType: String? = null,
    val baseUrl: String? = null
)
@Serializable private data class AdminAiProviderConfigInput(val models: List<AdminAiProviderModelInput>)
@Serializable private data class AdminAiProviderModelInput(
    val id: String,
    val inputCentsPerMillion: Long,
    val outputCentsPerMillion: Long,
    val cachedInputCentsPerMillion: Long? = null
)

@Serializable private data class AdminOrdersResponse(val orders: List<AdminOrderResponse>)
@Serializable private data class AdminOrderResponse(
    val id: String,
    val merchantOrderNo: String,
    val accountId: String,
    val productId: String,
    val provider: String,
    val amountCents: Long,
    val giftCents: Long,
    val status: String,
    val providerTransactionId: String?,
    val createdAt: String,
    val paidAt: String?
)
@Serializable private data class AdminWalletsResponse(val wallets: List<AdminWalletResponse>)
@Serializable private data class AdminWalletResponse(
    val accountId: String,
    val giftCents: Long,
    val cashCents: Long,
    val availableCents: Long
)
@Serializable private data class AdminAiJobsResponse(val jobs: List<AdminAiJobResponse>)
@Serializable private data class AdminAiJobResponse(
    val id: String,
    val accountId: String,
    val serverInstanceId: String,
    val draftId: String?,
    val status: String,
    val operation: String,
    val providerId: String,
    val model: String,
    val inputTokens: Long?,
    val outputTokens: Long?,
    val costAmount: Long?,
    val errorCode: String?,
    val createdAt: String,
    val updatedAt: String,
    val finishedAt: String?
)
@Serializable private data class AdminReleasesResponse(val releases: List<AdminReleaseResponse>)
@Serializable private data class AdminReleaseResponse(
    val id: String,
    val accountId: String,
    val serverInstanceId: String,
    val draftId: String,
    val draftVersionId: String,
    val draftVersionNumber: Long,
    val expectedManifestRevision: String,
    val targetManifestRevision: String,
    val signingKeyId: String,
    val transactionId: String?,
    val transactionStatus: String?,
    val createdAt: String
)
