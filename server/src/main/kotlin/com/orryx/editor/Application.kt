package com.orryx.editor

import com.orryx.editor.audit.PostgresAuditRepository
import com.orryx.editor.config.AppConfig
import com.orryx.editor.database.DatabaseMigrator
import com.orryx.editor.database.R2dbcDatabase
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
import com.orryx.editor.plugins.configureRouting
import com.orryx.editor.plugins.configureWebSockets
import com.orryx.editor.relay.RelayFeatureFlags
import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ServerEndpoint
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.loadSecuritySettings
import com.orryx.editor.security.requireSecureAdminKey
import com.orryx.editor.session.PostgresEditorSessionRepository
import com.orryx.editor.session.PostgresRelayEditorSessionStore
import com.orryx.editor.update.ArtifactDownloader
import com.orryx.editor.update.GitHubReleaseClient
import com.orryx.editor.update.PostgresUpdateJobStore
import com.orryx.editor.update.UpdateHttpClientFactory
import com.orryx.editor.update.UpdateJobRunner
import com.orryx.editor.update.UpdateService
import com.orryx.editor.update.UpdateStartupReconciler
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant

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

        val registry = SessionRegistry(config.sessions.relayRequestTimeout.toMillis())
        val relayFeatures = RelayFeatureFlags(
            protocolV2Enabled = config.editorProtocol.v2Enabled,
            v2WritesEnabled = config.editorProtocol.v2WritesEnabled,
        )
        val relayHandler = RelayHandler(registry, relaySessionStore, config.sessions.ttl.toMillis(), relayFeatures)
        val serverEndpoint = ServerEndpoint(registry, licenseManager, relayFeatures)

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
                ketherDocsService = ketherDocsService
            )
            configureWebSockets(relayHandler, serverEndpoint, config.security)

            launch {
                while (isActive) {
                    delay(config.sessions.cleanupInterval.toMillis())
                    registry.cleanupExpiredTokens()
                    editorSessions.cleanup(Instant.now())
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
