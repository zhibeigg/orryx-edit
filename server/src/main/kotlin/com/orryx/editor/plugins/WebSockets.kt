package com.orryx.editor.plugins

import com.orryx.editor.relay.RelayHandler
import com.orryx.editor.relay.ServerEndpoint
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.resolveClientIp
import io.ktor.http.HttpHeaders
import io.ktor.server.application.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*

fun Application.configureWebSockets(
    relayHandler: RelayHandler,
    serverEndpoint: ServerEndpoint,
    securitySettings: SecuritySettings = SecuritySettings()
) {
    install(WebSockets) {
        pingPeriodMillis = 15_000
        timeoutMillis = 15_000
        maxFrameSize = 1_048_576 // 1 MB，防止恶意超大帧导致 OOM
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
            val remoteIp = resolveClientIp(
                remoteAddress = call.request.local.remoteAddress,
                forwardedHeader = call.request.headers[HttpHeaders.Forwarded],
                xForwardedForHeader = call.request.headers[HttpHeaders.XForwardedFor],
                trustedProxies = securitySettings.trustedProxies
            )
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
