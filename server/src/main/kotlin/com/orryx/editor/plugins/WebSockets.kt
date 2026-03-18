package com.orryx.editor.plugins

import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ServerEndpoint
import io.ktor.server.application.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*

fun Application.configureWebSockets(
    relayHandler: RelayHandler,
    serverEndpoint: ServerEndpoint
) {
    install(WebSockets) {
        pingPeriodMillis = 15_000
        timeoutMillis = 15_000
        maxFrameSize = Long.MAX_VALUE
        masking = false
    }

    routing {
        webSocket("/ws") {
            log.info("浏览器客户端已连接")
            try {
                for (frame in incoming) {
                    if (frame is Frame.Text) {
                        relayHandler.handleBrowserMessage(this, frame.readText())
                    }
                }
            } catch (e: Exception) {
                log.error("浏览器 WebSocket 错误: ${e.message}")
            } finally {
                relayHandler.onBrowserDisconnect(this)
                log.info("浏览器客户端已断开")
            }
        }

        webSocket("/ws/server") {
            // 获取连接方 IP（支持反代 X-Forwarded-For）
            val remoteIp = call.request.headers["X-Forwarded-For"]?.split(",")?.firstOrNull()?.trim()
                ?: call.request.local.remoteAddress
            log.info("插件端已连接: $remoteIp")
            serverEndpoint.onServerConnect(this, remoteIp)
            try {
                for (frame in incoming) {
                    if (frame is Frame.Text) {
                        serverEndpoint.handleServerMessage(this, frame.readText())
                    }
                }
            } catch (e: Exception) {
                log.error("插件端 WebSocket 错误: ${e.message}")
            } finally {
                serverEndpoint.onServerDisconnect(this)
                log.info("插件端已断开: $remoteIp")
            }
        }
    }
}
