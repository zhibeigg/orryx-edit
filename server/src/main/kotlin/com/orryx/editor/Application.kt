package com.orryx.editor

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.plugins.configureRouting
import com.orryx.editor.plugins.configureWebSockets
import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ServerEndpoint
import com.orryx.editor.relay.SessionRegistry
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import java.io.File

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 9090
    val adminKey = System.getenv("ADMIN_KEY") ?: "change-me"
    val dataDir = File(System.getenv("DATA_DIR") ?: "data")

    val licenseManager = LicenseManager(dataDir)
    val registry = SessionRegistry()

    println("=== Orryx Editor Server ===")
    println("  端口: $port")
    println("  数据目录: ${dataDir.absolutePath}")
    println("  访问: http://localhost:$port")
    println("  插件端: ws://localhost:$port/ws/server")
    println("  管理API: POST /api/admin/license (Authorization: Bearer $adminKey)")
    println("===========================")

    embeddedServer(Netty, port = port) {
        val relayHandler = RelayHandler(registry, licenseManager)
        val serverEndpoint = ServerEndpoint(registry, licenseManager)
        configureRouting(licenseManager, registry, adminKey)
        configureWebSockets(relayHandler, serverEndpoint)
    }.start(wait = true)
}
