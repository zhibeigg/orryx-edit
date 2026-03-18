package com.orryx.editor.plugins

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.relay.SessionRegistry
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.http.content.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable

@Serializable
data class CreateLicenseRequest(val owner: String, val days: Int = 30)

@Serializable
data class RenewRequest(val days: Int)

fun Application.configureRouting(
    licenseManager: LicenseManager,
    registry: SessionRegistry,
    adminKey: String
) {
    install(ContentNegotiation) {
        json()
    }

    install(CORS) {
        val corsHost = System.getenv("CORS_HOST")
        if (corsHost != null) {
            allowHost(corsHost)
        } else {
            anyHost()
        }
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Authorization)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
    }

    routing {
        staticResources("/", "static") {
            default("index.html")
        }

        // ======== Actions Schema API ========
        get("/api/actions-schema") {
            val schemaFile = java.io.File("actions-schema.json")
            if (schemaFile.exists()) {
                call.respondText(schemaFile.readText(), ContentType.Application.Json)
            } else {
                call.respondText("""{"version":"1.0","pluginVersion":"unknown","actions":[]}""", ContentType.Application.Json)
            }
        }

        // ======== 管理 API ========
        route("/api/admin") {
            post("/license") {
                if (!checkAdmin(call, adminKey)) return@post
                val body = call.receive<CreateLicenseRequest>()
                val entry = licenseManager.createLicense(body.owner, body.days)
                call.respondText(licenseToJson(entry, false, 0), ContentType.Application.Json)
            }

            get("/licenses") {
                if (!checkAdmin(call, adminKey)) return@get
                val onlineKeys = registry.getOnlineServerKeys()
                val list = licenseManager.list().map {
                    val online = it.serverKey in onlineKeys
                    val count = registry.onlineSessionCount(it.serverKey)
                    licenseToJson(it, online, count)
                }
                call.respondText("[${list.joinToString(",")}]", ContentType.Application.Json)
            }

            delete("/license/{license}") {
                if (!checkAdmin(call, adminKey)) return@delete
                val license = call.parameters["license"] ?: ""
                call.respondText("""{"success":${licenseManager.revoke(license)}}""", ContentType.Application.Json)
            }

            put("/license/{license}") {
                if (!checkAdmin(call, adminKey)) return@put
                val license = call.parameters["license"] ?: ""
                call.respondText("""{"success":${licenseManager.enable(license)}}""", ContentType.Application.Json)
            }

            post("/license/{license}/renew") {
                if (!checkAdmin(call, adminKey)) return@post
                val license = call.parameters["license"] ?: ""
                val body = call.receive<RenewRequest>()
                call.respondText("""{"success":${licenseManager.renew(license, body.days)}}""", ContentType.Application.Json)
            }

            // 清空绑定 IP 列表
            put("/license/{license}/ip") {
                if (!checkAdmin(call, adminKey)) return@put
                val license = call.parameters["license"] ?: ""
                call.respondText("""{"success":${licenseManager.clearIps(license)}}""", ContentType.Application.Json)
            }

            get("/stats") {
                if (!checkAdmin(call, adminKey)) return@get
                call.respondText(
                    """{"servers":${registry.serverCount()},"browsers":${registry.browserCount()},"tokens":${registry.tokenCount()},"licenses":${licenseManager.list().size}}""",
                    ContentType.Application.Json
                )
            }
        }

        // ======== 客户自助 API（用 license 认证） ========
        route("/api/license") {
            get("/info") {
                val entry = checkLicense(call, licenseManager) ?: return@get
                val online = registry.isServerOnline(entry.serverKey)
                val count = registry.onlineSessionCount(entry.serverKey)
                call.respondText(licenseToJson(entry, online, count), ContentType.Application.Json)
            }

            // 清空绑定 IP（下次插件连接时会自动添加新 IP）
            delete("/ip") {
                val entry = checkLicense(call, licenseManager) ?: return@delete
                licenseManager.clearIps(entry.license)
                call.respondText("""{"success":true}""", ContentType.Application.Json)
            }
        }

        // SPA：/admin, /portal 等路径返回 index.html
        for (spaPath in listOf("/admin", "/portal")) {
            get(spaPath) {
                val resource = call.resolveResource("static/index.html")
                if (resource != null) call.respond(resource)
                else call.respondText("Not Found", status = HttpStatusCode.NotFound)
            }
        }
    }
}

private fun licenseToJson(entry: com.orryx.editor.license.LicenseEntry, online: Boolean, onlineCount: Int = 0): String {
    val ipsJson = entry.boundIps.joinToString(",") { "\"$it\"" }
    return """{"license":"${entry.license}","owner":"${entry.owner}","serverKey":"${entry.serverKey}","enabled":${entry.enabled},"online":$online,"onlineCount":$onlineCount,"createdAt":${entry.createdAt},"expiresAt":${entry.expiresAt},"boundIps":[$ipsJson],"remainingDays":${entry.remainingDays()}}"""
}

private suspend fun checkAdmin(call: ApplicationCall, adminKey: String): Boolean {
    val auth = call.request.header("Authorization")
    if (auth != "Bearer $adminKey") {
        call.respondText("""{"error":"Unauthorized"}""", ContentType.Application.Json, HttpStatusCode.Unauthorized)
        return false
    }
    return true
}

private suspend fun checkLicense(call: ApplicationCall, licenseManager: LicenseManager): com.orryx.editor.license.LicenseEntry? {
    val auth = call.request.header("Authorization")?.removePrefix("Bearer ")?.trim() ?: ""
    if (auth.isEmpty()) {
        call.respondText("""{"error":"缺少 Authorization header"}""", ContentType.Application.Json, HttpStatusCode.Unauthorized)
        return null
    }
    val entry = licenseManager.get(auth)
    if (entry == null) {
        call.respondText("""{"error":"License 不存在"}""", ContentType.Application.Json, HttpStatusCode.Unauthorized)
        return null
    }
    return entry
}
