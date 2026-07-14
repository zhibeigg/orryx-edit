package com.orryx.editor

import com.orryx.editor.ai.AiJobService
import com.orryx.editor.ai.AiJobWorker
import com.orryx.editor.ai.AiProviderCatalogService
import com.orryx.editor.ai.AiProviderModel
import com.orryx.editor.ai.AiProviderRegistry
import com.orryx.editor.ai.PostgresAiProviderCatalogRepository
import com.orryx.editor.ai.RegistryCostCalculator
import com.orryx.editor.ai.StoredProviderConfig
import com.orryx.editor.ai.OpenAiCompatibleProvider
import com.orryx.editor.ai.OpenAiProviderConfig
import com.orryx.editor.ai.PostgresAiAccessPolicy
import com.orryx.editor.ai.PostgresAiJobRepository
import com.orryx.editor.audit.PostgresAuditRepository
import com.orryx.editor.auth.AccountService
import com.orryx.editor.auth.Argon2idPasswordHasher
import com.orryx.editor.auth.PostgresAccountStore
import com.orryx.editor.auth.PostgresSessionStore
import com.orryx.editor.auth.SessionService
import com.orryx.editor.claim.ClaimService
import com.orryx.editor.claim.PostgresCommercialTransactionStore
import com.orryx.editor.commercial.CommercialReleaseServices
import com.orryx.editor.commercial.CommercialServices
import com.orryx.editor.config.AppConfig
import com.orryx.editor.database.DatabaseMigrator
import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.draft.DraftArtifactSinkAdapter
import com.orryx.editor.draft.DraftMaterializer
import com.orryx.editor.draft.DraftService
import com.orryx.editor.draft.PostgresDraftRepository
import com.orryx.editor.entitlement.EntitlementService
import com.orryx.editor.entitlement.PostgresEntitlementStore
import com.orryx.editor.ketherdocs.BundledKetherDocsLoader
import com.orryx.editor.ketherdocs.KetherDocsHealth
import com.orryx.editor.ketherdocs.KetherDocsRemoteClient
import com.orryx.editor.ketherdocs.KetherDocsService
import com.orryx.editor.ketherdocs.KetherDocsValidator
import com.orryx.editor.ketherdocs.PostgresKetherDocsRepository
import com.orryx.editor.license.LegacyLicenseImporter
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.license.LicenseService
import com.orryx.editor.license.PostgresLicenseRepository
import com.orryx.editor.payment.AlipayProvider
import com.orryx.editor.payment.PaymentService
import com.orryx.editor.payment.PostgresPaymentSettlementStore
import com.orryx.editor.payment.Rsa2
import com.orryx.editor.release.CommercialReleaseServerAccess
import com.orryx.editor.release.Ed25519ReleaseSigner
import com.orryx.editor.release.PostgresReleaseRepository
import com.orryx.editor.release.ReleaseRecoveryWorker
import com.orryx.editor.release.ReleaseService
import com.orryx.editor.release.ReleaseSnapshotService
import com.orryx.editor.release.ReleaseTransactionCoordinator
import com.orryx.editor.plugins.configureRouting
import com.orryx.editor.plugins.configureWebSockets
import com.orryx.editor.protocol.ReleaseResultData
import com.orryx.editor.relay.RelayFeatureFlags
import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ReleaseRelayDispatcher
import com.orryx.editor.relay.ServerEndpoint
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.runner.KtorRunnerClient
import com.orryx.editor.runner.RunnerClientConfig
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.loadSecuritySettings
import com.orryx.editor.security.requireSecureAdminKey
import com.orryx.editor.session.PostgresEditorSessionRepository
import com.orryx.editor.session.PostgresRelayEditorSessionStore
import com.orryx.editor.snapshot.PostgresSnapshotRepository
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.update.ArtifactDownloader
import com.orryx.editor.update.GitHubReleaseClient
import com.orryx.editor.update.PostgresUpdateJobStore
import com.orryx.editor.update.UpdateHttpClientFactory
import com.orryx.editor.update.UpdateJobRunner
import com.orryx.editor.update.UpdateService
import com.orryx.editor.update.UpdateStartupReconciler
import com.orryx.editor.wallet.PostgresWalletStore
import com.orryx.editor.wallet.WalletService
import io.ktor.client.HttpClient
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import java.io.File
import java.time.Instant
import java.util.Base64

data class ServerConfig(
    val port: Int,
    val adminKey: String,
    val dataDir: File,
    val securitySettings: SecuritySettings
)

/** 保留给安全配置单元测试；生产启动统一使用 [AppConfig]。 */
fun loadServerConfig(environment: Map<String, String> = System.getenv()): ServerConfig {
    val port = environment["PORT"]?.toIntOrNull() ?: 9090
    require(port in 1..65535) { "PORT 必须在 1..65535 范围内" }
    return ServerConfig(
        port = port,
        adminKey = requireSecureAdminKey(environment["ADMIN_KEY"]),
        dataDir = File(environment["DATA_DIR"] ?: "data"),
        securitySettings = loadSecuritySettings(environment)
    )
}

private suspend fun createCommercialServices(
    config: AppConfig,
    database: R2dbcDatabase,
    httpClient: HttpClient,
    applicationScope: CoroutineScope
): CommercialServices? {
    if (!config.commercialFeatures.accountsEnabled) return null

    val accounts = AccountService(PostgresAccountStore(database), Argon2idPasswordHasher())
    val sessions = SessionService(PostgresSessionStore(database), lifetime = config.accountWeb.sessionTtl)
    val commercialStore = PostgresCommercialTransactionStore(database)
    val claims = ClaimService(commercialStore)
    val entitlements = EntitlementService(PostgresEntitlementStore(database))
    val wallets = WalletService(PostgresWalletStore(database))

    val alipayConfig = config.alipay
    val paymentStore = PostgresPaymentSettlementStore(database)
    val payment = if (alipayConfig != null) {
        PaymentService(
            store = paymentStore,
            providers = listOf(
                AlipayProvider(
                    appId = alipayConfig.appId,
                    sellerId = alipayConfig.sellerId,
                    merchantPrivateKey = Rsa2.privateKey(alipayConfig.privateKey),
                    alipayPublicKey = Rsa2.publicKey(alipayConfig.publicKey),
                    notifyUrl = alipayConfig.notifyUrl,
                    returnUrl = alipayConfig.returnUrl
                )
            )
        )
    } else null

    val snapshotRepository = if (config.commercialFeatures.cloudDraftsEnabled) {
        PostgresSnapshotRepository(database)
    } else null
    val draftRepository = snapshotRepository?.let { PostgresDraftRepository(database) }
    val snapshotService = snapshotRepository?.let(::SnapshotService)
    val draftService = if (snapshotRepository != null && draftRepository != null) {
        DraftService(draftRepository, snapshotRepository)
    } else null
    val releaseServices = if (config.release.enabled) {
        val releaseRepository = PostgresReleaseRepository(database)
        val privateKey = Base64.getDecoder().decode(
            requireNotNull(config.release.signingPrivateKeyPkcs8Base64) { "发布签名私钥缺失" }
        )
        val publicKey = Base64.getDecoder().decode(
            requireNotNull(config.release.signingPublicKeyX509Base64) { "发布签名公钥缺失" }
        )
        val signer = try {
            Ed25519ReleaseSigner.fromPkcs8AndX509(privateKey, publicKey)
        } finally {
            privateKey.fill(0)
            publicKey.fill(0)
        }
        CommercialReleaseServices(
            publisher = ReleaseService(
                drafts = requireNotNull(draftRepository) { "发布事务依赖云端草稿" },
                materializer = DraftMaterializer(draftRepository, requireNotNull(snapshotRepository)),
                repository = releaseRepository,
                signer = signer,
                serverAccess = CommercialReleaseServerAccess(commercialStore)
            ),
            repository = releaseRepository,
            snapshots = ReleaseSnapshotService(
                releases = releaseRepository,
                snapshots = requireNotNull(snapshotService)
            )
        )
    } else null

    var aiService: AiJobService? = null
    var aiRepository: PostgresAiJobRepository? = null
    var aiCatalog: AiProviderCatalogService? = null
    if (config.commercialFeatures.aiWorkbenchEnabled) {
        val aiConfig = requireNotNull(config.aiProvider) { "AI Provider 配置缺失" }
        val runnerConfig = requireNotNull(config.runner) { "Runner 配置缺失" }
        val initialModels = listOf(
            AiProviderModel(
                id = aiConfig.model,
                inputCentsPerMillion = aiConfig.inputCostPerMillionCents,
                outputCentsPerMillion = aiConfig.outputCostPerMillionCents
            )
        )
        val providerConfigJson = Json.encodeToString(
            StoredProviderConfig.serializer(),
            StoredProviderConfig(initialModels)
        )
        database.withConnection { connection ->
            executeFully(
                connection.createStatement(
                    """
                    INSERT INTO ai_providers(
                        provider_id, provider_type, display_name, base_url, default_model,
                        enabled, config, created_at, updated_at
                    ) VALUES ($1, 'OPENAI_COMPATIBLE', $2, $3, $4, TRUE, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (provider_id) DO UPDATE
                    SET provider_type = EXCLUDED.provider_type,
                        base_url = EXCLUDED.base_url,
                        config = CASE WHEN ai_providers.config = '{}'::jsonb THEN EXCLUDED.config ELSE ai_providers.config END,
                        updated_at = CURRENT_TIMESTAMP
                    """.trimIndent()
                )
                    .bind(0, aiConfig.providerId)
                    .bind(1, aiConfig.providerId)
                    .bind(2, aiConfig.baseUrl.toString())
                    .bind(3, aiConfig.model)
                    .bind(4, providerConfigJson)
            )
        }
        val provider = OpenAiCompatibleProvider(
            httpClient,
            OpenAiProviderConfig(
                providerId = aiConfig.providerId,
                baseUrl = aiConfig.baseUrl,
                apiKey = aiConfig.apiKey,
                requestTimeout = aiConfig.requestTimeout,
                maxResponseBytes = aiConfig.maxResponseBytes
            )
        )
        val providerRegistry = AiProviderRegistry(providers = listOf(provider))
        aiCatalog = AiProviderCatalogService(PostgresAiProviderCatalogRepository(database), providerRegistry)
        aiCatalog.initialize()
        val runner = KtorRunnerClient(
            httpClient,
            RunnerClientConfig(
                endpoint = runnerConfig.endpoint,
                sharedSecret = runnerConfig.sharedSecret,
                requestTimeout = runnerConfig.requestTimeout,
                maxResponseBytes = runnerConfig.maxResponseBytes,
                allowedPrivateBaseUris = setOf(runnerConfig.endpoint)
            )
        )
        aiRepository = PostgresAiJobRepository(database)
        aiService = AiJobService(
            repository = aiRepository,
            providerRegistry = providerRegistry,
            runnerClient = runner,
            accessPolicy = PostgresAiAccessPolicy(database, aiConfig.usageReservationCents),
            artifactSink = DraftArtifactSinkAdapter(requireNotNull(draftService)),
            costCalculator = RegistryCostCalculator(providerRegistry)
        )
        AiJobWorker(applicationScope, aiService, "${config.updates.instanceId}-ai").start()
    }

    return CommercialServices(
        features = config.commercialFeatures,
        accountWeb = config.accountWeb,
        accounts = accounts,
        sessions = sessions,
        claims = claims,
        entitlements = entitlements,
        wallets = wallets,
        payment = payment,
        paymentStore = paymentStore,
        paymentGateway = alipayConfig?.gateway,
        drafts = draftService,
        snapshots = snapshotService,
        releases = releaseServices,
        aiJobs = aiService,
        aiJobRepository = aiRepository,
        aiProviders = aiCatalog
    )
}

suspend fun main() {
    val config = AppConfig.load()
    val database = R2dbcDatabase.create(config.database)
    val applicationJob = SupervisorJob()
    val applicationScope = CoroutineScope(applicationJob + Dispatchers.Default)
    val updateHttpClient = UpdateHttpClientFactory.create()

    try {
        database.warmUp()
        DatabaseMigrator(database).migrate()

        val licenseRepository = PostgresLicenseRepository(database)
        val licenseService = LicenseService(licenseRepository)
        val licenseManager = LicenseManager(licenseService)
        val auditRepository = PostgresAuditRepository(database)
        val editorSessions = PostgresEditorSessionRepository(database)
        val relaySessionStore = PostgresRelayEditorSessionStore(database)
        val legacyResult = LegacyLicenseImporter(database).importOnce(config.legacyLicensesFile)
        val commercialServices = createCommercialServices(config, database, updateHttpClient, applicationScope)

        val registry = SessionRegistry(config.sessions.relayRequestTimeout.toMillis())
        val relayFeatures = RelayFeatureFlags(
            protocolV2Enabled = config.editorProtocol.v2Enabled,
            v2WritesEnabled = config.editorProtocol.v2WritesEnabled,
            releaseTransactionsEnabled = config.editorProtocol.releaseTransactionsEnabled,
        )
        val relayHandler = RelayHandler(registry, relaySessionStore, config.sessions.ttl.toMillis(), relayFeatures)
        val releaseCoordinator = commercialServices?.releases?.let { releases ->
            ReleaseTransactionCoordinator(
                repository = releases.repository,
                dispatcher = ReleaseRelayDispatcher(registry, config.release.enabled),
                snapshots = releases.snapshots,
                publicBaseUrl = requireNotNull(config.release.publicBaseUrl),
                transferTtl = config.release.transferTtl,
                transactionLease = config.release.transactionLease,
                readinessTimeout = config.release.readinessTimeout,
                maxReleaseBytes = config.release.maxReleaseBytes
            )
        }
        releaseCoordinator?.let { coordinator ->
            applicationScope.launch {
                ReleaseRecoveryWorker(
                    coordinator = coordinator,
                    workerId = "${config.updates.instanceId}-release",
                    onFailure = { failure ->
                        println("release_recovery_worker_failed type=${failure::class.simpleName}")
                    }
                ).run()
            }
        }
        val releaseJson = Json { ignoreUnknownKeys = false }
        val serverEndpoint = ServerEndpoint(
            registry = registry,
            licenseManager = licenseManager,
            features = relayFeatures,
            onRegistered = { server ->
                commercialServices?.let { services ->
                    try {
                        services.claims.registerClaimedServer(server.licenseKey, server.serverId, server.serverName)
                            ?.instance
                            ?.id
                    } catch (failure: CancellationException) {
                        throw failure
                    } catch (failure: Throwable) {
                        println("commercial_server_sync_failed type=${failure::class.simpleName}")
                        null
                    }
                }
            },
            onReleaseResult = { server, message ->
                val coordinator = releaseCoordinator
                if (coordinator != null) {
                    try {
                        val result = releaseJson.decodeFromJsonElement(ReleaseResultData.serializer(), message.data)
                        val outcome = coordinator.handlePluginResult(server, result)
                        if (outcome is com.orryx.editor.release.PluginReleaseResultOutcome.RetryableFailure) {
                            println("release_result_retryable transaction=${result.transactionId} reason=${outcome.reason}")
                        }
                    } catch (failure: CancellationException) {
                        throw failure
                    } catch (failure: Throwable) {
                        println("release_result_rejected type=${failure::class.simpleName}")
                    }
                }
            }
        )

        val updateStore = PostgresUpdateJobStore(database, config.updates.instanceId)
        val updateService = UpdateService(
            buildInfo = config.buildInfo,
            config = config.updates,
            releases = GitHubReleaseClient(updateHttpClient, config.updates),
            downloader = ArtifactDownloader(updateHttpClient, config.updates),
            store = updateStore,
            runner = UpdateJobRunner(applicationScope),
            activeUsers = registry::browserCount,
            onRestartRequested = {
                delay(750)
                kotlin.system.exitProcess(42)
            }
        )

        val ketherDocsValidator = KetherDocsValidator(config.ketherDocs)
        val bundledKetherDocs = BundledKetherDocsLoader(ketherDocsValidator)
        val ketherDocsService = KetherDocsService(
            config = config.ketherDocs,
            repository = PostgresKetherDocsRepository(database),
            source = KetherDocsRemoteClient(updateHttpClient, config.ketherDocs, ketherDocsValidator),
            validator = ketherDocsValidator,
            bundledLoader = bundledKetherDocs::load
        )
        ketherDocsService.initialize()
        applicationScope.launch { ketherDocsService.runScheduler() }

        val pendingUpdate = UpdateStartupReconciler(config.updates.dataDirectory).reconcile()

        println("=== Orryx Editor Server ${config.buildInfo.version} ===")
        println("  端口: ${config.port}")
        println("  数据目录: ${config.dataDir}")
        println("  数据库: PostgreSQL / R2DBC")
        println("  旧 License 导入: ${legacyResult::class.simpleName}")
        println("  部署模式: ${config.buildInfo.deployment}")
        println("  Kether 文档: ${ketherDocsService.status().health} / ${ketherDocsService.status().source}")
        if (pendingUpdate != null) println("  更新状态: 待 launcher 应用 ${pendingUpdate.version}")
        println("====================================")

        val server = embeddedServer(Netty, port = config.port) {
            configureRouting(
                licenseManager = licenseManager,
                registry = registry,
                adminKey = config.adminKey,
                securitySettings = config.security,
                auditRepository = auditRepository,
                buildInfo = config.buildInfo,
                readinessCheck = { database.ping() && ketherDocsService.status().health != KetherDocsHealth.FAILED },
                updateService = updateService,
                ketherDocsService = ketherDocsService,
                commercialServices = commercialServices,
                releaseCoordinator = releaseCoordinator
            )
            configureWebSockets(relayHandler, serverEndpoint, config.security)

            launch {
                while (isActive) {
                    delay(config.sessions.cleanupInterval.toMillis())
                    registry.cleanupExpiredTokens()
                    editorSessions.cleanup(Instant.now())
                    commercialServices?.sessions?.cleanup()
                }
            }

            monitor.subscribe(ApplicationStopping) {
                applicationScope.cancel("Ktor application stopping")
            }
        }

        server.start(wait = true)
    } finally {
        applicationScope.cancel("Orryx server shutdown")
        updateHttpClient.close()
        database.closeAsync()
    }
}
