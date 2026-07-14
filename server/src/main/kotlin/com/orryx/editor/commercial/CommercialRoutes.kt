package com.orryx.editor.commercial

import com.orryx.editor.ai.AiJob
import com.orryx.editor.ai.AiJobErrorCode
import com.orryx.editor.ai.AiJobEvent
import com.orryx.editor.ai.AiJobException
import com.orryx.editor.ai.AiJobQuery
import com.orryx.editor.ai.AiJobStatus
import com.orryx.editor.ai.AiOperation
import com.orryx.editor.ai.AiProviderCatalogEntry
import com.orryx.editor.ai.AiProviderException
import com.orryx.editor.ai.CreateAiJobCommand
import com.orryx.editor.auth.Account
import com.orryx.editor.auth.RegisterAccountCommand
import com.orryx.editor.claim.ClaimLicenseCommand
import com.orryx.editor.claim.ServerInstance
import com.orryx.editor.draft.AppendDraftVersionCommand
import com.orryx.editor.draft.CreateDraftCommand
import com.orryx.editor.draft.Draft
import com.orryx.editor.entitlement.EntitlementType
import com.orryx.editor.payment.CreatePaymentCommand
import com.orryx.editor.payment.PaymentOrder
import com.orryx.editor.payment.PaymentOrderStatus
import com.orryx.editor.payment.PaymentProviderType
import com.orryx.editor.payment.PaymentSettlementOutcome
import com.orryx.editor.payment.ProductId
import com.orryx.editor.plugins.ApiError
import com.orryx.editor.rbac.CommercialPermission
import com.orryx.editor.rbac.PermissionEvaluator
import com.orryx.editor.release.PluginReleaseTransaction
import com.orryx.editor.release.PublishReleaseCommand
import com.orryx.editor.release.PublishReleaseResult
import com.orryx.editor.release.ReleaseTransactionCoordinator
import com.orryx.editor.release.ReleaseTransactionStatus
import com.orryx.editor.release.ReleaseTransferToken
import com.orryx.editor.release.SignedRelease
import com.orryx.editor.security.constantTimeEquals
import com.orryx.editor.snapshot.CreateSnapshotCommand
import com.orryx.editor.snapshot.SnapshotFile
import com.orryx.editor.snapshot.SnapshotManifest
import com.orryx.editor.snapshot.SnapshotSource
import com.orryx.editor.versioning.AppendVersionResult
import com.orryx.editor.versioning.DraftFile
import com.orryx.editor.versioning.DraftFileChangeType
import com.orryx.editor.versioning.DraftVersionSource
import com.orryx.editor.versioning.StoredDraftVersion
import com.orryx.editor.wallet.WalletLedgerEntry
import io.ktor.http.ContentType
import io.ktor.http.Cookie
import io.ktor.http.CookieEncoding
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.request.receiveParameters
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

private const val SESSION_COOKIE = "orryx_session"
private const val CSRF_COOKIE = "orryx_csrf"
private const val CSRF_HEADER = "X-CSRF-Token"

fun Route.commercialRoutes(
    services: CommercialServices,
    releaseCoordinator: ReleaseTransactionCoordinator? = null
) {
    if (!services.features.accountsEnabled) return
    route("/api/v2") {
        route("/auth") {
            post("/register") {
                val input = call.receive<RegisterInput>()
                val account = try {
                    services.accounts.register(RegisterAccountCommand(input.email, input.password, input.displayName))
                } catch (_: IllegalStateException) {
                    call.respond(HttpStatusCode.Conflict, ApiError("EMAIL_ALREADY_REGISTERED", "该邮箱已注册"))
                    return@post
                }
                call.issueSession(services, account)
            }
            post("/login") {
                val input = call.receive<LoginInput>()
                val account = services.accounts.authenticate(input.email, input.password)
                if (account == null) {
                    call.respond(HttpStatusCode.Unauthorized, ApiError("INVALID_CREDENTIALS", "邮箱或密码错误"))
                    return@post
                }
                call.issueSession(services, account)
            }
            get("/me") {
                val account = call.requireAccount(services) ?: return@get
                call.respond(AuthResponse(account.toResponse()))
            }
            post("/logout") {
                val token = call.requireSessionToken(services, requireCsrf = true) ?: return@post
                services.sessions.revoke(token)
                call.expireAccountCookies(services)
                call.respond(HttpStatusCode.NoContent)
            }
        }

        post("/licenses/claim") {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val input = call.receive<ClaimInput>()
            call.respond(services.claims.claim(ClaimLicenseCommand(account.id, input.license)))
        }

        get("/workspaces") {
            val account = call.requireAccount(services) ?: return@get
            val memberships = services.claims.membershipsForAccount(account.id)
            val workspaces = memberships.map { membership ->
                WorkspaceResponse(
                    id = membership.workspaceId,
                    workspaceId = membership.workspaceId,
                    displayName = "Workspace ${membership.workspaceId.take(8)}",
                    role = membership.role.name,
                    serverInstances = services.claims.serverInstances(membership.workspaceId).map(ServerInstance::toResponse)
                )
            }
            call.respond(WorkspacesResponse(workspaces))
        }

        route("/billing") {
            get("/summary") {
                val account = call.requireAccount(services) ?: return@get
                val entitlements = services.entitlements.list(account.id)
                val balance = services.wallets.balance(account.id)
                call.respond(
                    BillingSummaryResponse(
                        permanentAi = entitlements.any { it.type == EntitlementType.AI_EDITOR_PERMANENT },
                        entitlements = entitlements.map { EntitlementResponse(it.type.name, it.grantedAt.toString()) },
                        wallet = WalletResponse(balance.cashCents, balance.giftCents, balance.availableCents)
                    )
                )
            }
            get("/ledger") {
                val account = call.requireAccount(services) ?: return@get
                val limit = call.queryLimit() ?: return@get
                call.respond(WalletLedgerResponse(services.wallets.ledger(account.id, limit).map(WalletLedgerEntry::toResponse)))
            }
            get("/orders") {
                val account = call.requireAccount(services) ?: return@get
                val limit = call.queryLimit() ?: return@get
                val status = call.optionalEnumQuery<PaymentOrderStatus>("status") ?: if (call.request.queryParameters["status"] != null) return@get else null
                val orders = services.paymentStore?.listOrders(account.id, status, limit).orEmpty()
                call.respond(PaymentOrdersResponse(orders.map(PaymentOrder::toResponse)))
            }
            post("/orders") {
                val account = call.requireAccount(services, requireCsrf = true) ?: return@post
                val payment = services.payment
                val gateway = services.paymentGateway
                if (!services.features.alipayEnabled || payment == null || gateway == null) {
                    call.respond(HttpStatusCode.NotFound, ApiError("PAYMENT_DISABLED", "支付功能未启用"))
                    return@post
                }
                val input = call.receive<CreateOrderInput>()
                require(input.productCode == ProductId.AI_PERMANENT_99.name) { "productCode 无效" }
                if (services.entitlements.has(account.id, EntitlementType.AI_EDITOR_PERMANENT)) {
                    call.respond(HttpStatusCode.Conflict, ApiError("ENTITLEMENT_ALREADY_OWNED", "永久 AI Editor 权益已激活"))
                    return@post
                }
                val requestKey = call.request.headers["Idempotency-Key"]
                    ?.takeIf { it.length in 8..128 && it.matches(Regex("^[A-Za-z0-9._:-]+$")) }
                    ?: "web:${UUID.randomUUID()}"
                val created = try {
                    payment.create(
                        CreatePaymentCommand(account.id, ProductId.AI_PERMANENT_99, PaymentProviderType.ALIPAY, requestKey)
                    )
                } catch (_: IllegalStateException) {
                    call.respond(HttpStatusCode.Conflict, ApiError("PAYMENT_IDEMPOTENCY_CONFLICT", "支付请求冲突"))
                    return@post
                }
                call.respond(
                    BillingOrderResponse(
                        payUrl = buildPaymentUrl(gateway.toString(), created.request.fields),
                        orderId = created.order.id,
                        status = created.order.status.name
                    )
                )
            }
        }

        if (services.features.aiWorkbenchEnabled && services.aiProviders != null) {
            get("/ai/providers") {
                call.requireAccount(services) ?: return@get
                call.respond(AiProvidersResponse(services.aiProviders.listEnabled().map(AiProviderCatalogEntry::toPublicResponse)))
            }
        }

        post("/payments/alipay/notify") {
            val payment = services.payment
            if (!services.features.alipayEnabled || payment == null) {
                call.respondText("failure", status = HttpStatusCode.NotFound)
                return@post
            }
            val fields = call.receiveParameters().entries().associate { (key, values) -> key to values.first() }
            val settled = payment.handleNotification(PaymentProviderType.ALIPAY, fields)
            if (settled.outcome == PaymentSettlementOutcome.REJECTED) {
                call.respondText("failure", status = HttpStatusCode.BadRequest)
            } else {
                call.respondText("success")
            }
        }

        if (services.features.cloudDraftsEnabled && services.drafts != null && services.snapshots != null) {
            cloudDraftRoutes(services)
        }
        if (services.releases != null && releaseCoordinator != null) {
            releaseRoutes(services, releaseCoordinator)
        }
        if (services.features.aiWorkbenchEnabled && services.aiJobs != null && services.aiJobRepository != null) {
            aiJobRoutes(services)
        }
    }
}

private fun Route.cloudDraftRoutes(services: CommercialServices) {
    val drafts = checkNotNull(services.drafts)
    val snapshots = checkNotNull(services.snapshots)

    route("/server-instances/{instanceId}/snapshots") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val instanceId = call.requiredUuidParameter("instanceId") ?: return@get
            if (!services.claims.canAccessServer(account.id, instanceId)) return@get call.forbid()
            call.respond(snapshots.list(instanceId).map { it.toResponse() })
        }
        post {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val instanceId = call.requiredUuidParameter("instanceId") ?: return@post
            if (!services.claims.canAccessServer(account.id, instanceId)) return@post call.forbid()
            val input = call.receive<CreateSnapshotInput>()
            val files = input.files.map { file ->
                val revision = SnapshotManifest.contentRevision(file.content)
                file.revision?.let { require(it == revision) { "snapshot file revision 不匹配: ${file.path}" } }
                SnapshotFile(file.path, revision, file.content.toByteArray(Charsets.UTF_8).size.toLong(), file.content)
            }
            val snapshot = snapshots.createSnapshot(
                CreateSnapshotCommand(instanceId, files, SnapshotSource.BROWSER, input.expectedManifestRevision)
            )
            call.respond(HttpStatusCode.Created, snapshot.toResponse())
        }
    }

    route("/drafts") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val instanceId = call.request.queryParameters["serverInstanceId"] ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("MISSING_SERVER_INSTANCE", "缺少 serverInstanceId"))
                return@get
            }
            val normalized = runCatching { UUID.fromString(instanceId).toString() }.getOrNull() ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_SERVER_INSTANCE", "serverInstanceId 无效"))
                return@get
            }
            if (!services.claims.canAccessServer(account.id, normalized)) return@get call.forbid()
            call.respond(DraftsResponse(drafts.list(account.id, normalized).map(Draft::toResponse)))
        }
        post {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val input = call.receive<CreateDraftInput>()
            if (!services.claims.canAccessServer(account.id, input.serverInstanceId)) return@post call.forbid()
            val draft = drafts.createDraft(
                CreateDraftCommand(account.id, input.serverInstanceId, UUID.fromString(input.baseSnapshotId), input.title)
            )
            call.respond(HttpStatusCode.Created, draft.toResponse())
        }
        get("/{draftId}") {
            val account = call.requireAccount(services) ?: return@get
            val id = call.requiredUuidParameter("draftId")?.let(UUID::fromString) ?: return@get
            val draft = drafts.get(id)
            if (draft == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
            } else if (draft.accountId != account.id) {
                call.forbid()
            } else {
                call.respond(draft.toResponse())
            }
        }
        get("/{draftId}/versions") {
            val account = call.requireAccount(services) ?: return@get
            val draftId = call.requiredUuidParameter("draftId")?.let(UUID::fromString) ?: return@get
            val draft = drafts.get(draftId)
            if (draft == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
                return@get
            }
            if (draft.accountId != account.id) return@get call.forbid()
            val limit = call.queryLimit() ?: return@get
            call.respond(DraftVersionsResponse(drafts.listVersions(draftId, limit).map(StoredDraftVersion::toResponse)))
        }
        get("/{draftId}/versions/{versionId}") {
            val account = call.requireAccount(services) ?: return@get
            val draftId = call.requiredUuidParameter("draftId")?.let(UUID::fromString) ?: return@get
            val versionId = call.requiredUuidParameter("versionId")?.let(UUID::fromString) ?: return@get
            val draft = drafts.get(draftId)
            if (draft == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
                return@get
            }
            if (draft.accountId != account.id) return@get call.forbid()
            val version = drafts.getVersion(versionId)
            if (version == null || version.version.draftId != draftId) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_VERSION_NOT_FOUND", "草稿版本不存在"))
            } else {
                call.respond(version.toResponse())
            }
        }
        post("/{draftId}/versions") {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val draftId = call.requiredUuidParameter("draftId")?.let(UUID::fromString) ?: return@post
            val draft = drafts.get(draftId)
            if (draft == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
                return@post
            }
            if (draft.accountId != account.id) return@post call.forbid()
            val input = call.receive<AppendVersionInput>()
            require(input.source == DraftVersionSource.MANUAL.name) { "浏览器只能追加 MANUAL 草稿版本" }
            val files = input.files.map(DraftFileInput::toDraftFile)
            when (val result = drafts.appendVersion(
                AppendDraftVersionCommand(
                    draftId = draftId,
                    expectedCurrentVersion = input.expectedCurrentVersion,
                    files = files,
                    source = DraftVersionSource.MANUAL,
                    authorAccountId = account.id
                )
            )) {
                is AppendVersionResult.Created -> call.respond(HttpStatusCode.Created, result.stored.toResponse())
                is AppendVersionResult.Conflict -> call.respond(
                    HttpStatusCode.Conflict,
                    ApiError("DRAFT_VERSION_CONFLICT", "草稿版本冲突", "expected=${result.expectedCurrentVersion},actual=${result.actualCurrentVersion}")
                )
                AppendVersionResult.DraftArchived -> call.respond(HttpStatusCode.Conflict, ApiError("DRAFT_ARCHIVED", "草稿已归档"))
                AppendVersionResult.DraftNotFound -> call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
            }
        }
    }

    route("/server-instances/{instanceId}/history") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val instanceId = call.requiredUuidParameter("instanceId") ?: return@get
            if (!services.claims.canAccessServer(account.id, instanceId)) return@get call.forbid()
            val limit = call.queryLimit() ?: return@get
            val fetchLimit = 100
            val items = mutableListOf<ServerHistoryItemResponse>()
            snapshots.list(instanceId, fetchLimit).forEach { snapshot ->
                items += ServerHistoryItemResponse(
                    type = "SNAPSHOT",
                    id = snapshot.id.toString(),
                    serverInstanceId = snapshot.serverInstanceId,
                    createdAt = snapshot.createdAt.toString(),
                    manifestRevision = snapshot.manifestRevision,
                    source = snapshot.source.name
                )
            }
            services.releases?.repository?.let { repository ->
                repository.listReleases(account.id, instanceId, null, fetchLimit).forEach { release ->
                    items += ServerHistoryItemResponse(
                        type = "RELEASE",
                        id = release.id.toString(),
                        serverInstanceId = release.serverInstanceId,
                        createdAt = release.createdAt.toString(),
                        manifestRevision = release.targetManifestRevision,
                        draftId = release.draftId.toString(),
                        releaseId = release.id.toString()
                    )
                }
                repository.listTransactions(account.id, instanceId, null, fetchLimit).forEach { transaction ->
                    items += ServerHistoryItemResponse(
                        type = "RELEASE_TRANSACTION",
                        id = transaction.id.toString(),
                        serverInstanceId = transaction.serverInstanceId,
                        createdAt = transaction.createdAt.toString(),
                        status = transaction.status.name,
                        releaseId = transaction.releaseId.toString(),
                        transactionId = transaction.id.toString()
                    )
                }
            }
            call.respond(
                ServerHistoryResponse(
                    items.sortedWith(
                        compareByDescending<ServerHistoryItemResponse> { Instant.parse(it.createdAt) }
                            .thenByDescending { it.id }
                    ).take(limit)
                )
            )
        }
        post("/{historyId}/restore") {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val instanceId = call.requiredUuidParameter("instanceId") ?: return@post
            val historyId = call.requiredUuidParameter("historyId")?.let(UUID::fromString) ?: return@post
            if (!services.claims.canAccessServer(account.id, instanceId)) return@post call.forbid()
            val input = call.receive<RestoreSnapshotInput>()
            require(input.title.isNotBlank()) { "title 不能为空" }
            val directSnapshot = snapshots.get(historyId)?.takeIf { it.serverInstanceId == instanceId }
            val snapshot = directSnapshot ?: run {
                val releaseRepository = services.releases?.repository
                val release = releaseRepository?.findRelease(historyId)?.takeIf {
                    it.accountId == account.id && it.serverInstanceId == instanceId
                }
                if (release == null) {
                    call.respond(HttpStatusCode.NotFound, ApiError("HISTORY_NOT_FOUND", "历史记录不存在"))
                    return@post
                }
                val releaseFiles = releaseRepository.listFiles(release.id)
                snapshots.createSnapshot(
                    CreateSnapshotCommand(
                        serverInstanceId = instanceId,
                        files = releaseFiles.map { file ->
                            SnapshotFile(file.path, file.contentRevision, file.size, file.content)
                        },
                        source = SnapshotSource.RELEASE,
                        expectedManifestRevision = release.targetManifestRevision
                    )
                )
            }
            val draft = drafts.createDraft(CreateDraftCommand(account.id, instanceId, snapshot.id, input.title))
            call.respond(HttpStatusCode.Created, draft.toResponse())
        }
    }
}

private fun Route.releaseRoutes(
    services: CommercialServices,
    coordinator: ReleaseTransactionCoordinator
) {
    val releases = checkNotNull(services.releases)
    val drafts = checkNotNull(services.drafts)

    route("/releases") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val limit = call.queryLimit() ?: return@get
            val serverInstanceId = call.optionalUuidQuery("serverInstanceId") ?: if (call.request.queryParameters["serverInstanceId"] != null) return@get else null
            val draftId = call.optionalUuidQuery("draftId")?.let(UUID::fromString)
                ?: if (call.request.queryParameters["draftId"] != null) return@get else null
            if (serverInstanceId != null && call.requireServerPermission(
                    services,
                    account,
                    serverInstanceId,
                    CommercialPermission.RELEASE_READ
                ) == null
            ) return@get
            call.respond(
                ReleasesResponse(
                    releases.repository.listReleases(account.id, serverInstanceId, draftId, limit).map(SignedRelease::toResponse)
                )
            )
        }
        post {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val idempotencyKey = call.request.headers["Idempotency-Key"]
                ?.takeIf { it.length in 8..128 && it.matches(Regex("^[A-Za-z0-9._:-]+$")) }
                ?: run {
                    call.respond(
                        HttpStatusCode.BadRequest,
                        ApiError("IDEMPOTENCY_KEY_REQUIRED", "发布必须提供合法的 Idempotency-Key")
                    )
                    return@post
                }
            val input = call.receive<PublishReleaseInput>()
            val serverInstanceId = runCatching { UUID.fromString(input.serverInstanceId).toString() }.getOrNull()
                ?: run {
                    call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_SERVER_INSTANCE", "serverInstanceId 无效"))
                    return@post
                }
            if (call.requireServerPermission(
                    services,
                    account,
                    serverInstanceId,
                    CommercialPermission.RELEASE_CREATE
                ) == null
            ) return@post
            val draftId = runCatching { UUID.fromString(input.draftId) }.getOrNull() ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_DRAFT_ID", "draftId 无效"))
                return@post
            }
            val versionId = runCatching { UUID.fromString(input.draftVersionId) }.getOrNull() ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_DRAFT_VERSION_ID", "draftVersionId 无效"))
                return@post
            }
            val draft = drafts.get(draftId)
            if (draft == null || draft.accountId != account.id || draft.serverInstanceId != serverInstanceId) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
                return@post
            }
            val result = try {
                releases.publisher.publish(
                    PublishReleaseCommand(
                        accountId = account.id,
                        serverInstanceId = serverInstanceId,
                        draftId = draftId,
                        draftVersionId = versionId,
                        expectedCurrentVersion = input.expectedCurrentVersion,
                        expectedBaseManifestRevision = input.expectedBaseManifestRevision,
                        idempotencyKey = idempotencyKey
                    )
                )
            } catch (failure: IllegalArgumentException) {
                val conflict = failure.message?.contains("已变化") == true ||
                    failure.message?.contains("只能发布当前") == true ||
                    failure.message?.contains("manifest") == true
                call.respond(
                    if (conflict) HttpStatusCode.Conflict else HttpStatusCode.BadRequest,
                    ApiError(if (conflict) "RELEASE_CONFLICT" else "INVALID_RELEASE", "发布请求无效")
                )
                return@post
            }
            when (result) {
                is PublishReleaseResult.Accepted -> call.respond(
                    HttpStatusCode.Accepted,
                    PublishReleaseResponse(
                        release = result.release.toResponse(),
                        transaction = result.transaction.toResponse(),
                        replayed = result.replayed
                    )
                )
                is PublishReleaseResult.IdempotencyConflict -> call.respond(
                    HttpStatusCode.Conflict,
                    ApiError(
                        "RELEASE_IDEMPOTENCY_CONFLICT",
                        "Idempotency-Key 已用于不同发布请求",
                        result.existingTransactionId.toString()
                    )
                )
                is PublishReleaseResult.ActiveTransactionConflict -> call.respond(
                    HttpStatusCode.Conflict,
                    ApiError(
                        "RELEASE_TRANSACTION_ACTIVE",
                        "该服务器实例已有未完成发布事务",
                        result.existingTransactionId.toString()
                    )
                )
            }
        }

        get("/{releaseId}") {
            val account = call.requireAccount(services) ?: return@get
            val releaseId = call.requiredUuidParameter("releaseId")?.let(UUID::fromString) ?: return@get
            val release = releases.repository.findRelease(releaseId)
            if (release == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_NOT_FOUND", "发布包不存在"))
                return@get
            }
            if (release.accountId != account.id || call.requireServerPermission(
                    services,
                    account,
                    release.serverInstanceId,
                    CommercialPermission.RELEASE_READ
                ) == null
            ) return@get
            call.respond(release.toResponse())
        }

        get("/{releaseId}/operations") {
            val releaseId = call.requiredUuidParameter("releaseId")?.let(UUID::fromString) ?: return@get
            val release = releases.repository.findRelease(releaseId)
            if (release == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_NOT_FOUND", "发布包不存在"))
                return@get
            }
            if (!call.authorizeReleaseTransfer(releases, release)) return@get
            val files = releases.repository.listFiles(release.id)
            call.noStoreReleaseResponse()
            call.respond(
                ReleaseOperationsResponse(
                    canonicalVersion = "orryx-release-v1",
                    canonicalPayloadSha256 = sha256(release.canonicalPayload),
                    signingKeyId = release.keyId,
                    signature = release.signature,
                    releaseId = release.id.toString(),
                    serverInstanceId = release.serverInstanceId,
                    stableServerId = release.stableServerId,
                    draftId = release.draftId.toString(),
                    draftVersionId = release.draftVersionId.toString(),
                    expectedManifestRevision = release.expectedBaseManifestRevision,
                    targetManifestRevision = release.targetManifestRevision,
                    createdAt = release.createdAt.toEpochMilli(),
                    fileCount = files.size,
                    totalBytes = files.sumOf { it.size },
                    files = files.map { file ->
                        ReleaseOperationFileResponse(
                            ordinal = file.ordinal,
                            path = file.path,
                            baseRevision = file.baseRevision,
                            contentRevision = file.contentRevision,
                            size = file.size,
                            contentUrl = coordinator.fileUrl(release.id, file.ordinal)
                        )
                    }
                )
            )
        }

        get("/{releaseId}/files/{ordinal}") {
            val releaseId = call.requiredUuidParameter("releaseId")?.let(UUID::fromString) ?: return@get
            val ordinal = call.parameters["ordinal"]?.toIntOrNull()?.takeIf { it >= 0 } ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_RELEASE_FILE", "release file ordinal 无效"))
                return@get
            }
            val release = releases.repository.findRelease(releaseId)
            if (release == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_NOT_FOUND", "发布包不存在"))
                return@get
            }
            if (!call.authorizeReleaseTransfer(releases, release)) return@get
            val file = releases.repository.findFile(release.id, ordinal)
            if (file == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_FILE_NOT_FOUND", "发布文件不存在"))
                return@get
            }
            val content = file.content.toByteArray(StandardCharsets.UTF_8)
            if (content.size.toLong() != file.size || sha256(content) != file.contentRevision) {
                content.fill(0)
                call.respond(HttpStatusCode.InternalServerError, ApiError("RELEASE_FILE_CORRUPT", "发布文件完整性校验失败"))
                return@get
            }
            call.noStoreReleaseResponse()
            call.respondBytes(content, ContentType.Application.OctetStream)
        }
    }

    route("/release-transactions/{transactionId}") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val transactionId = call.requiredUuidParameter("transactionId")?.let(UUID::fromString) ?: return@get
            val transaction = releases.repository.findTransaction(transactionId)
            val release = transaction?.let { releases.repository.findRelease(it.releaseId) }
            if (transaction == null || release == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_TRANSACTION_NOT_FOUND", "发布事务不存在"))
                return@get
            }
            if (release.accountId != account.id || call.requireServerPermission(
                    services,
                    account,
                    release.serverInstanceId,
                    CommercialPermission.RELEASE_READ
                ) == null
            ) return@get
            call.respond(transaction.toResponse())
        }
        post("/rollback") {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val transactionId = call.requiredUuidParameter("transactionId")?.let(UUID::fromString) ?: return@post
            val transaction = releases.repository.findTransaction(transactionId)
            val release = transaction?.let { releases.repository.findRelease(it.releaseId) }
            if (transaction == null || release == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("RELEASE_TRANSACTION_NOT_FOUND", "发布事务不存在"))
                return@post
            }
            if (release.accountId != account.id || call.requireServerPermission(
                    services,
                    account,
                    release.serverInstanceId,
                    CommercialPermission.RELEASE_ROLLBACK
                ) == null
            ) return@post
            val input = call.receive<RollbackReleaseInput>()
            val updated = coordinator.requestRollback(transaction.id, input.reason)
            if (updated == null) {
                call.respond(HttpStatusCode.Conflict, ApiError("RELEASE_ROLLBACK_CONFLICT", "发布事务无法回滚"))
            } else {
                call.respond(HttpStatusCode.Accepted, updated.toResponse())
            }
        }
    }
}

private suspend fun ApplicationCall.requireServerPermission(
    services: CommercialServices,
    account: Account,
    serverInstanceId: String,
    permission: CommercialPermission
): ServerInstance? {
    val instance = services.claims.findServerInstance(serverInstanceId)
    if (instance == null) {
        respond(HttpStatusCode.NotFound, ApiError("SERVER_INSTANCE_NOT_FOUND", "服务器实例不存在"))
        return null
    }
    val membership = services.claims.memberships(instance.workspaceId).firstOrNull { it.accountId == account.id }
    if (membership == null || !PermissionEvaluator().isAllowed(membership.role, permission)) {
        forbid()
        return null
    }
    return instance
}

private suspend fun ApplicationCall.authorizeReleaseTransfer(
    services: CommercialReleaseServices,
    release: SignedRelease
): Boolean {
    val authorization = request.headers[HttpHeaders.Authorization].orEmpty()
    if (!authorization.startsWith("Bearer ") || authorization.length !in 48..320) {
        response.headers.append(HttpHeaders.WWWAuthenticate, "Bearer")
        respond(HttpStatusCode.Unauthorized, ApiError("RELEASE_TRANSFER_REQUIRED", "需要发布传输令牌"))
        return false
    }
    val rawToken = authorization.removePrefix("Bearer ")
    val grant = services.repository.authorizeTransfer(
        releaseId = release.id,
        tokenHash = ReleaseTransferToken.hash(rawToken),
        serverInstanceId = release.serverInstanceId,
        now = Instant.now()
    )
    if (grant == null) {
        response.headers.append(HttpHeaders.WWWAuthenticate, "Bearer")
        respond(HttpStatusCode.Unauthorized, ApiError("RELEASE_TRANSFER_INVALID", "发布传输令牌无效或已过期"))
        return false
    }
    return true
}

private fun ApplicationCall.noStoreReleaseResponse() {
    response.headers.append(HttpHeaders.CacheControl, "no-store")
    response.headers.append("X-Content-Type-Options", "nosniff")
}

private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

private fun SignedRelease.toResponse() = SignedReleaseResponse(
    id = id.toString(),
    serverInstanceId = serverInstanceId,
    draftId = draftId.toString(),
    draftVersionId = draftVersionId.toString(),
    draftVersionNumber = draftVersionNumber,
    expectedManifestRevision = expectedBaseManifestRevision,
    targetManifestRevision = targetManifestRevision,
    signingKeyId = keyId,
    canonicalPayloadSha256 = sha256(canonicalPayload),
    createdAt = createdAt.toString()
)

private fun PluginReleaseTransaction.toResponse() = ReleaseTransactionResponse(
    id = id.toString(),
    releaseId = releaseId.toString(),
    serverInstanceId = serverInstanceId,
    status = status.name,
    stateVersion = stateVersion,
    errorCode = errorCode,
    createdAt = createdAt.toString(),
    updatedAt = updatedAt.toString(),
    finishedAt = finishedAt?.toString()
)

private fun Route.aiJobRoutes(services: CommercialServices) {
    val jobs = checkNotNull(services.aiJobs)
    val repository = checkNotNull(services.aiJobRepository)
    route("/ai/jobs") {
        get {
            val account = call.requireAccount(services) ?: return@get
            val limit = call.queryLimit() ?: return@get
            val serverInstanceId = call.optionalUuidQuery("serverInstanceId")?.let(UUID::fromString)
                ?: if (call.request.queryParameters["serverInstanceId"] != null) return@get else null
            val draftId = call.optionalUuidQuery("draftId")?.let(UUID::fromString)
                ?: if (call.request.queryParameters["draftId"] != null) return@get else null
            val status = call.optionalEnumQuery<AiJobStatus>("status")
                ?: if (call.request.queryParameters["status"] != null) return@get else null
            if (serverInstanceId != null && !services.claims.canAccessServer(account.id, serverInstanceId.toString())) {
                return@get call.forbid()
            }
            call.respond(
                AiJobsResponse(
                    repository.list(
                        AiJobQuery(
                            accountId = UUID.fromString(account.id),
                            serverInstanceId = serverInstanceId,
                            draftId = draftId,
                            status = status,
                            limit = limit
                        )
                    ).map(AiJob::toResponse)
                )
            )
        }
        post {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val input = call.receive<CreateAiJobInput>()
            val serverInstanceId = UUID.fromString(input.serverInstanceId)
            if (!services.claims.canAccessServer(account.id, serverInstanceId.toString())) return@post call.forbid()
            if (!services.entitlements.has(account.id, EntitlementType.AI_EDITOR_PERMANENT)) {
                call.respond(HttpStatusCode.PaymentRequired, ApiError("AI_ENTITLEMENT_REQUIRED", "需要永久 AI Editor 权益"))
                return@post
            }
            val draftId = input.draftId?.let(UUID::fromString) ?: run {
                call.respond(HttpStatusCode.BadRequest, ApiError("DRAFT_REQUIRED", "AI 任务必须写入云端草稿"))
                return@post
            }
            val draft = services.drafts?.get(draftId)
            if (draft == null || draft.accountId != account.id || draft.serverInstanceId != serverInstanceId.toString()) {
                call.respond(HttpStatusCode.NotFound, ApiError("DRAFT_NOT_FOUND", "草稿不存在"))
                return@post
            }
            val job = try {
                jobs.submit(
                    CreateAiJobCommand(
                        accountId = UUID.fromString(account.id),
                        serverInstanceId = serverInstanceId,
                        draftId = draftId,
                        baseVersionId = input.baseVersionId?.let(UUID::fromString),
                        operation = AiOperation.valueOf(input.operation),
                        prompt = input.prompt,
                        providerId = input.providerId,
                        model = input.model.orEmpty(),
                        idempotencyKey = input.idempotencyKey
                    )
                )
            } catch (failure: AiJobException) {
                val status = if (failure.code == AiJobErrorCode.IDEMPOTENCY_CONFLICT) HttpStatusCode.Conflict else HttpStatusCode.BadRequest
                call.respond(status, ApiError(failure.code, "AI 任务请求无效"))
                return@post
            } catch (failure: AiProviderException) {
                call.respond(HttpStatusCode.BadRequest, ApiError(failure.error.code, "AI Provider 配置无效"))
                return@post
            }
            call.respond(HttpStatusCode.Accepted, job.toResponse())
        }
        get("/{jobId}") {
            val account = call.requireAccount(services) ?: return@get
            val jobId = call.requiredUuidParameter("jobId")?.let(UUID::fromString) ?: return@get
            val job = repository.find(jobId)
            if (job == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("AI_JOB_NOT_FOUND", "AI 任务不存在"))
            } else if (job.accountId.toString() != account.id ||
                !services.claims.canAccessServer(account.id, job.serverInstanceId.toString())
            ) {
                call.forbid()
            } else {
                call.respond(job.toResponse())
            }
        }
        get("/{jobId}/events") {
            val account = call.requireAccount(services) ?: return@get
            val jobId = call.requiredUuidParameter("jobId")?.let(UUID::fromString) ?: return@get
            val job = repository.find(jobId)
            if (job == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("AI_JOB_NOT_FOUND", "AI 任务不存在"))
                return@get
            }
            if (job.accountId.toString() != account.id ||
                !services.claims.canAccessServer(account.id, job.serverInstanceId.toString())
            ) return@get call.forbid()
            val afterSeq = call.request.queryParameters["afterSeq"]?.toLongOrNull() ?: 0L
            if (afterSeq < 0) {
                call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_AFTER_SEQ", "afterSeq 无效"))
                return@get
            }
            val limit = call.queryLimit() ?: return@get
            call.respond(AiJobEventsResponse(repository.listEvents(jobId, afterSeq, limit).map(AiJobEvent::toResponse)))
        }
        post("/{jobId}/cancel") {
            val account = call.requireAccount(services, requireCsrf = true) ?: return@post
            val jobId = call.requiredUuidParameter("jobId")?.let(UUID::fromString) ?: return@post
            val job = repository.find(jobId)
            if (job == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("AI_JOB_NOT_FOUND", "AI 任务不存在"))
                return@post
            }
            if (job.accountId.toString() != account.id ||
                !services.claims.canAccessServer(account.id, job.serverInstanceId.toString())
            ) return@post call.forbid()
            val canceled = try {
                jobs.cancel(jobId)
            } catch (failure: AiJobException) {
                call.respond(HttpStatusCode.Conflict, ApiError(failure.code, "AI 任务当前状态不可取消"))
                return@post
            }
            if (canceled == null) {
                call.respond(HttpStatusCode.NotFound, ApiError("AI_JOB_NOT_FOUND", "AI 任务不存在"))
            } else {
                call.respond(canceled.toResponse())
            }
        }
    }
}

private suspend fun ApplicationCall.issueSession(services: CommercialServices, account: Account) {
    val issued = services.sessions.create(account.id)
    val maxAge = services.accountWeb.sessionTtl.seconds.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    response.cookies.append(accountCookie(SESSION_COOKIE, issued.token, services, httpOnly = true, maxAge = maxAge))
    response.cookies.append(accountCookie(CSRF_COOKIE, issued.csrfToken, services, httpOnly = false, maxAge = maxAge))
    respond(HttpStatusCode.Created, AuthResponse(account.toResponse()))
}

private suspend fun ApplicationCall.requireAccount(
    services: CommercialServices,
    requireCsrf: Boolean = false
): Account? {
    val token = requireSessionToken(services, requireCsrf) ?: return null
    val session = services.sessions.validate(token) ?: run {
        respond(HttpStatusCode.Unauthorized, ApiError("SESSION_INVALID", "账户会话无效或已过期"))
        return null
    }
    val account = services.accounts.find(session.accountId)
    if (account == null) respond(HttpStatusCode.Unauthorized, ApiError("ACCOUNT_NOT_FOUND", "账户不存在"))
    return account
}

private suspend fun ApplicationCall.requireSessionToken(
    services: CommercialServices,
    requireCsrf: Boolean
): String? {
    val token = request.cookies[SESSION_COOKIE]
    if (token.isNullOrBlank()) {
        respond(HttpStatusCode.Unauthorized, ApiError("SESSION_REQUIRED", "需要登录账户"))
        return null
    }
    if (requireCsrf) {
        val cookieToken = request.cookies[CSRF_COOKIE].orEmpty()
        val headerToken = request.headers[CSRF_HEADER].orEmpty()
        if (cookieToken.isEmpty() || headerToken.isEmpty() || !constantTimeEquals(cookieToken, headerToken) ||
            services.sessions.validate(token, headerToken) == null
        ) {
            respond(HttpStatusCode.Forbidden, ApiError("CSRF_REJECTED", "CSRF 校验失败"))
            return null
        }
    }
    return token
}

private fun ApplicationCall.expireAccountCookies(services: CommercialServices) {
    response.cookies.append(accountCookie(SESSION_COOKIE, "", services, httpOnly = true, maxAge = 0))
    response.cookies.append(accountCookie(CSRF_COOKIE, "", services, httpOnly = false, maxAge = 0))
}

private fun accountCookie(
    name: String,
    value: String,
    services: CommercialServices,
    httpOnly: Boolean,
    maxAge: Int
): Cookie = Cookie(
    name = name,
    value = value,
    encoding = CookieEncoding.URI_ENCODING,
    maxAge = maxAge,
    domain = services.accountWeb.cookieDomain,
    path = "/",
    secure = services.accountWeb.secureCookie,
    httpOnly = httpOnly,
    extensions = mapOf("SameSite" to "Lax")
)

private suspend fun ApplicationCall.forbid() {
    respond(HttpStatusCode.Forbidden, ApiError("ACCESS_DENIED", "无权访问该资源"))
}

private suspend fun ApplicationCall.requiredUuidParameter(name: String): String? {
    val raw = parameters[name]
    val normalized = raw?.let { runCatching { UUID.fromString(it).toString() }.getOrNull() }
    if (normalized == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_ID", "$name 无效"))
    return normalized
}

private suspend fun ApplicationCall.optionalUuidQuery(name: String): String? {
    val raw = request.queryParameters[name] ?: return null
    val normalized = runCatching { UUID.fromString(raw).toString() }.getOrNull()
    if (normalized == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_QUERY", "$name 无效"))
    return normalized
}

private suspend inline fun <reified T : Enum<T>> ApplicationCall.optionalEnumQuery(name: String): T? {
    val raw = request.queryParameters[name] ?: return null
    val value = enumValues<T>().firstOrNull { it.name == raw.uppercase() }
    if (value == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_QUERY", "$name 无效"))
    return value
}

private suspend fun ApplicationCall.queryLimit(): Int? {
    val raw = request.queryParameters["limit"] ?: return 100
    val limit = raw.toIntOrNull()?.takeIf { it in 1..100 }
    if (limit == null) respond(HttpStatusCode.BadRequest, ApiError("INVALID_LIMIT", "limit 必须在 1..100 范围内"))
    return limit
}

private fun buildPaymentUrl(gateway: String, fields: Map<String, String>): String = buildString {
    append(gateway)
    append(if ('?' in gateway) '&' else '?')
    append(fields.entries.joinToString("&") { (key, value) ->
        "${urlEncode(key)}=${urlEncode(value)}"
    })
}

private fun urlEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

private fun Account.toResponse() = AccountResponse(id, email, displayName, status.name, createdAt.toString(), updatedAt.toString())
private fun ServerInstance.toResponse() = ServerInstanceResponse(id, displayName, stableServerId, licenseKey, lastSeenAt.toString(), false)
private fun Draft.toResponse() = DraftResponse(
    id.toString(), accountId, serverInstanceId, baseSnapshotId.toString(), title, status.name,
    currentVersion, createdAt.toString(), updatedAt.toString()
)
private fun com.orryx.editor.snapshot.ServerSnapshot.toResponse() = SnapshotResponse(
    id.toString(), serverInstanceId, manifestRevision, source.name, createdAt.toString(),
    files.map { SnapshotFileResponse(it.path, it.revision, it.size, it.content) }
)
private fun StoredDraftVersion.toResponse() = DraftVersionResponse(
    version.id.toString(), version.draftId.toString(), version.versionNumber, version.source.name,
    version.manifestRevision, version.createdAt.toString(), files.map { it.toResponse() }
)
private fun DraftFile.toResponse() = DraftFileResponse(changeType.name, path, baseRevision, contentRevision, size, content)
private fun DraftFileInput.toDraftFile(): DraftFile = when (DraftFileChangeType.valueOf(changeType)) {
    DraftFileChangeType.UPSERT -> {
        val value = requireNotNull(content) { "UPSERT 必须提供 content" }
        DraftFile(
            DraftFileChangeType.UPSERT,
            path,
            baseRevision,
            SnapshotManifest.contentRevision(value),
            value.toByteArray(Charsets.UTF_8).size.toLong(),
            value
        )
    }
    DraftFileChangeType.DELETE -> DraftFile(DraftFileChangeType.DELETE, path, baseRevision, null, 0, null)
}
private fun AiJob.toResponse() = AiJobResponse(
    id.toString(), serverInstanceId.toString(), draftId?.toString(), baseVersionId?.toString(), status.name,
    operation.name, prompt, providerId, model, runnerResult, usage?.let { UsageResponse(it.inputTokens, it.outputTokens, it.cachedInputTokens, it.totalTokens) },
    costAmount, errorCode, errorMessage, createdAt.toString(), updatedAt.toString(), startedAt?.toString(), finishedAt?.toString()
)
private fun AiJobEvent.toResponse() = AiJobEventResponse(jobId.toString(), seq, eventType, payload, createdAt.toString())
private fun AiProviderCatalogEntry.toPublicResponse() = AiProviderResponse(
    id = providerId,
    displayName = displayName,
    defaultModel = defaultModel,
    models = models.map { it.id }
)
private fun WalletLedgerEntry.toResponse() = WalletLedgerEntryResponse(
    id, operationType.name, giftDeltaCents, cashDeltaCents, giftBalanceCents, cashBalanceCents, description, createdAt.toString()
)
private fun PaymentOrder.toResponse() = PaymentOrderResponse(
    id, merchantOrderNo, productId.name, provider.name, amountCents, giftCents, status.name,
    providerTransactionId, createdAt.toString(), paidAt?.toString()
)

@Serializable private data class RegisterInput(val email: String, val password: String, val displayName: String)
@Serializable private data class LoginInput(val email: String, val password: String)
@Serializable private data class ClaimInput(val license: String)
@Serializable private data class CreateOrderInput(val productCode: String)
@Serializable private data class AuthResponse(val account: AccountResponse)
@Serializable private data class AccountResponse(val id: String, val email: String, val displayName: String, val status: String, val createdAt: String, val updatedAt: String)
@Serializable private data class WorkspacesResponse(val workspaces: List<WorkspaceResponse>)
@Serializable private data class WorkspaceResponse(val id: String, val workspaceId: String, val displayName: String, val role: String, val serverInstances: List<ServerInstanceResponse>)
@Serializable private data class ServerInstanceResponse(val id: String, val displayName: String, val stableServerId: String, val licenseKey: String, val lastSeenAt: String, val online: Boolean)
@Serializable private data class BillingSummaryResponse(val permanentAi: Boolean, val entitlements: List<EntitlementResponse>, val wallet: WalletResponse)
@Serializable private data class EntitlementResponse(val type: String, val grantedAt: String)
@Serializable private data class WalletResponse(val cashCents: Long, val giftCents: Long, val availableCents: Long)
@Serializable private data class BillingOrderResponse(val payUrl: String, val orderId: String, val status: String)
@Serializable private data class WalletLedgerResponse(val entries: List<WalletLedgerEntryResponse>)
@Serializable private data class WalletLedgerEntryResponse(
    val id: String,
    val operationType: String,
    val giftDeltaCents: Long,
    val cashDeltaCents: Long,
    val giftBalanceCents: Long,
    val cashBalanceCents: Long,
    val description: String,
    val createdAt: String
)
@Serializable private data class PaymentOrdersResponse(val orders: List<PaymentOrderResponse>)
@Serializable private data class PaymentOrderResponse(
    val id: String,
    val merchantOrderNo: String,
    val productId: String,
    val provider: String,
    val amountCents: Long,
    val giftCents: Long,
    val status: String,
    val providerTransactionId: String?,
    val createdAt: String,
    val paidAt: String?
)
@Serializable private data class AiProvidersResponse(val providers: List<AiProviderResponse>)
@Serializable private data class AiProviderResponse(
    val id: String,
    val displayName: String,
    val defaultModel: String,
    val models: List<String>
)

@Serializable private data class CreateSnapshotInput(val files: List<SnapshotFileInput>, val expectedManifestRevision: String? = null)
@Serializable private data class SnapshotFileInput(val path: String, val content: String, val revision: String? = null)
@Serializable private data class SnapshotResponse(val id: String, val serverInstanceId: String, val manifestRevision: String, val source: String, val createdAt: String, val files: List<SnapshotFileResponse>)
@Serializable private data class SnapshotFileResponse(val path: String, val revision: String, val size: Long, val content: String?)

@Serializable private data class CreateDraftInput(val serverInstanceId: String, val baseSnapshotId: String, val title: String)
@Serializable private data class AppendVersionInput(val expectedCurrentVersion: Long, val source: String, val files: List<DraftFileInput>)
@Serializable private data class DraftFileInput(val changeType: String, val path: String, val baseRevision: String? = null, val content: String? = null)
@Serializable private data class DraftsResponse(val drafts: List<DraftResponse>)
@Serializable private data class DraftResponse(val id: String, val accountId: String, val serverInstanceId: String, val baseSnapshotId: String, val title: String, val status: String, val currentVersion: Long, val createdAt: String, val updatedAt: String)
@Serializable private data class DraftVersionsResponse(val versions: List<DraftVersionResponse>)
@Serializable private data class DraftVersionResponse(val id: String, val draftId: String, val versionNumber: Long, val source: String, val manifestRevision: String, val createdAt: String, val files: List<DraftFileResponse>)
@Serializable private data class DraftFileResponse(val changeType: String, val path: String, val baseRevision: String?, val contentRevision: String?, val size: Long, val content: String?)
@Serializable private data class RestoreSnapshotInput(val title: String)
@Serializable private data class ServerHistoryResponse(val items: List<ServerHistoryItemResponse>)
@Serializable private data class ServerHistoryItemResponse(
    val type: String,
    val id: String,
    val serverInstanceId: String,
    val createdAt: String,
    val status: String? = null,
    val manifestRevision: String? = null,
    val source: String? = null,
    val draftId: String? = null,
    val releaseId: String? = null,
    val transactionId: String? = null
)

@Serializable private data class PublishReleaseInput(
    val serverInstanceId: String,
    val draftId: String,
    val draftVersionId: String,
    val expectedCurrentVersion: Long,
    val expectedBaseManifestRevision: String
)
@Serializable private data class RollbackReleaseInput(val reason: String = "USER_REQUESTED")
@Serializable private data class PublishReleaseResponse(
    val release: SignedReleaseResponse,
    val transaction: ReleaseTransactionResponse,
    val replayed: Boolean
)
@Serializable private data class ReleasesResponse(val releases: List<SignedReleaseResponse>)
@Serializable private data class SignedReleaseResponse(
    val id: String,
    val serverInstanceId: String,
    val draftId: String,
    val draftVersionId: String,
    val draftVersionNumber: Long,
    val expectedManifestRevision: String,
    val targetManifestRevision: String,
    val signingKeyId: String,
    val canonicalPayloadSha256: String,
    val createdAt: String
)
@Serializable private data class ReleaseTransactionResponse(
    val id: String,
    val releaseId: String,
    val serverInstanceId: String,
    val status: String,
    val stateVersion: Long,
    val errorCode: String?,
    val createdAt: String,
    val updatedAt: String,
    val finishedAt: String?
)
@Serializable private data class ReleaseOperationsResponse(
    val canonicalVersion: String,
    val canonicalPayloadSha256: String,
    val signingKeyId: String,
    val signature: String,
    val releaseId: String,
    val serverInstanceId: String,
    val stableServerId: String,
    val draftId: String,
    val draftVersionId: String,
    val expectedManifestRevision: String,
    val targetManifestRevision: String,
    val createdAt: Long,
    val fileCount: Int,
    val totalBytes: Long,
    val files: List<ReleaseOperationFileResponse>
)
@Serializable private data class ReleaseOperationFileResponse(
    val ordinal: Int,
    val path: String,
    val baseRevision: String?,
    val contentRevision: String,
    val size: Long,
    val contentUrl: String
)

@Serializable private data class CreateAiJobInput(
    val serverInstanceId: String,
    val draftId: String? = null,
    val baseVersionId: String? = null,
    val operation: String,
    val prompt: String,
    val providerId: String,
    val model: String? = null,
    val idempotencyKey: String
)
@Serializable private data class AiJobsResponse(val jobs: List<AiJobResponse>)
@Serializable private data class AiJobEventsResponse(val events: List<AiJobEventResponse>)
@Serializable private data class AiJobEventResponse(
    val jobId: String,
    val seq: Long,
    val eventType: String,
    val payload: JsonElement,
    val createdAt: String
)
@Serializable private data class UsageResponse(val inputTokens: Long, val outputTokens: Long, val cachedInputTokens: Long, val totalTokens: Long)
@Serializable private data class AiJobResponse(
    val id: String,
    val serverInstanceId: String,
    val draftId: String?,
    val baseVersionId: String?,
    val status: String,
    val operation: String,
    val prompt: String,
    val providerId: String,
    val model: String,
    val runnerResult: JsonElement?,
    val usage: UsageResponse?,
    val costAmount: Long?,
    val errorCode: String?,
    val errorMessage: String?,
    val createdAt: String,
    val updatedAt: String,
    val startedAt: String?,
    val finishedAt: String?
)
