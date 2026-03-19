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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 9090
    val adminKey = System.getenv("ADMIN_KEY") ?: "change-me"
    val dataDir = File(System.getenv("DATA_DIR") ?: "data")

    if (adminKey == "change-me") {
        println("⚠️  警告: ADMIN_KEY 使用默认值，请设置环境变量 ADMIN_KEY 以保护管理接口！")
    }

    val licenseManager = LicenseManager(dataDir)
    val registry = SessionRegistry()

    // 定期清理过期 Token（每 5 分钟）
    val scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "token-cleanup").apply { isDaemon = true } }
    scheduler.scheduleAtFixedRate({ registry.cleanupExpiredTokens() }, 5, 5, TimeUnit.MINUTES)

    val maskedKey = if (adminKey.length > 4) adminKey.take(4) + "*".repeat(adminKey.length - 4) else "****"
    println("=== Orryx Editor Server ===")
    println("  端口: $port")
    println("  数据目录: ${dataDir.absolutePath}")
    println("  访问: http://localhost:$port")
    println("  插件端: ws://localhost:$port/ws/server")
    println("  管理API: POST /api/admin/license (Authorization: Bearer $maskedKey)")
    println("===========================")

    val server = embeddedServer(Netty, port = port) {
        val relayHandler = RelayHandler(registry)
        val serverEndpoint = ServerEndpoint(registry, licenseManager)
        configureRouting(licenseManager, registry, adminKey)
        configureWebSockets(relayHandler, serverEndpoint)
    }

    Runtime.getRuntime().addShutdownHook(Thread {
        println("正在关闭服务器...")
        scheduler.shutdown()
        licenseManager.shutdown()
        server.stop(500, 3000)
    })

    server.start(wait = true)
}
