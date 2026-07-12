package com.orryx.editor

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.plugins.configureRouting
import com.orryx.editor.plugins.configureWebSockets
import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ServerEndpoint
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.loadSecuritySettings
import com.orryx.editor.security.requireSecureAdminKey
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

data class ServerConfig(
    val port: Int,
    val adminKey: String,
    val dataDir: File,
    val securitySettings: SecuritySettings
)

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

fun main() {
    val config = loadServerConfig()
    val licenseManager = LicenseManager(config.dataDir)
    val registry = SessionRegistry()

    println("=== Orryx Editor Server ===")
    println("  端口: ${config.port}")
    println("  数据目录: ${config.dataDir.absolutePath}")
    println("  访问: http://localhost:${config.port}")
    println("  插件端: ws://localhost:${config.port}/ws/server")
    println("  管理API: POST /api/admin/license (Authorization: Bearer <ADMIN_KEY>)")
    println("===========================")

    val server = embeddedServer(Netty, port = config.port) {
        val relayHandler = RelayHandler(registry)
        val serverEndpoint = ServerEndpoint(registry, licenseManager)
        configureRouting(licenseManager, registry, config.adminKey, config.securitySettings)
        configureWebSockets(relayHandler, serverEndpoint, config.securitySettings)

        launch {
            while (isActive) {
                delay(5 * 60_000L)
                registry.cleanupExpiredTokens()
            }
        }

        monitor.subscribe(ApplicationStopping) {
            licenseManager.shutdown()
        }
    }

    server.start(wait = true)
}
