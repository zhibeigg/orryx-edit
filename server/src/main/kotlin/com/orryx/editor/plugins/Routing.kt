package com.orryx.editor.plugins

import com.orryx.editor.license.LicenseEntry
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.IpRateLimiter
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.constantTimeEquals
import com.orryx.editor.security.resolveClientIp
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.http.content.*
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import io.ktor.server.plugins.defaultheaders.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.Serializable

@Serializable
data class CreateLicenseRequest(val owner: String, val days: Int = 30)

@Serializable
data class RenewRequest(val days: Int)

@Serializable
data class LicenseResponse(
    val license: String,
    val owner: String,
    val serverKey: String,
    val enabled: Boolean,
    val online: Boolean,
    val onlineCount: Int = 0,
    val createdAt: Long,
    val expiresAt: Long,
    val boundIps: List<String>,
    val remainingDays: Long
)

@Serializable
data class ApiError(val code: String, val message: String, val error: String = message)

fun Application.configureRouting(
    licenseManager: LicenseManager,
    registry: SessionRegistry,
    adminKey: String,
    securitySettings: SecuritySettings = SecuritySettings(),
    adminRateLimiter: IpRateLimiter = IpRateLimiter()
) {
    install(ContentNegotiation) {
        json()
    }

    install(DefaultHeaders) {
        header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; form-action 'self'")
        header("X-Content-Type-Options", "nosniff")
        header("Referrer-Policy", "strict-origin-when-cross-origin")
        header("X-Frame-Options", "DENY")
        if (securitySettings.hstsEnabled) {
            header("Strict-Transport-Security", "max-age=31536000")
        }
    }

    if (securitySettings.corsOrigins.isNotEmpty()) {
        install(CORS) {
            securitySettings.corsOrigins.forEach { origin ->
                allowHost(origin.ktorHost, schemes = listOf(origin.scheme))
            }
            allowHeader(HttpHeaders.ContentType)
            allowHeader(HttpHeaders.Authorization)
            allowMethod(HttpMethod.Get)
            allowMethod(HttpMethod.Post)
            allowMethod(HttpMethod.Put)
            allowMethod(HttpMethod.Delete)
        }
    }

    install(StatusPages) {
        exception<BadRequestException> { call, _ ->
            call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_REQUEST", "请求格式无效"))
        }
        exception<IllegalArgumentException> { call, exception ->
            call.respond(HttpStatusCode.BadRequest, ApiError("INVALID_INPUT", exception.message ?: "输入无效"))
        }
        exception<Throwable> { call, exception ->
            call.application.log.error("request_failed method={} path={} type={}", call.request.httpMethod.value, call.request.path(), exception::class.simpleName)
            call.respond(HttpStatusCode.InternalServerError, ApiError("INTERNAL_ERROR", "服务器内部错误"))
        }
    }

    routing {
        staticResources("/", "static") {
            default("index.html")
        }

        // ======== Actions Schema API ========
        // Schema 由 Vite 从受版本控制的 schemas/actions-schema.json 打包为静态资源；
        // API 只做同源跳转，避免每个请求同步读取 cwd 文件。
        get("/api/actions-schema") {
            call.respondRedirect("/actions-schema.json", permanent = false)
        }

        // ======== 管理 API ========
        route("/api/admin") {
            post("/license") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@post
                val body = call.receive<CreateLicenseRequest>()
                val owner = validateOwner(body.owner)
                val days = validateDays(body.days, allowUnlimited = true)
                val entry = licenseManager.createLicense(owner, days)
                call.respondText(licenseToJson(entry, false, 0), ContentType.Application.Json)
            }

            get("/licenses") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@get
                val onlineKeys = registry.getOnlineServerKeys()
                val list = licenseManager.list().map {
                    val online = it.serverKey in onlineKeys
                    val count = registry.onlineSessionCount(it.serverKey)
                    licenseToJson(it, online, count)
                }
                call.respondText("[${list.joinToString(",")}]", ContentType.Application.Json)
            }

            delete("/license/{license}") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@delete
                val license = validateLicenseKey(call.parameters["license"])
                call.respondText("""{"success":${licenseManager.revoke(license)}}""", ContentType.Application.Json)
            }

            put("/license/{license}") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@put
                val license = validateLicenseKey(call.parameters["license"])
                call.respondText("""{"success":${licenseManager.enable(license)}}""", ContentType.Application.Json)
            }

            post("/license/{license}/renew") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@post
                val license = validateLicenseKey(call.parameters["license"])
                val body = call.receive<RenewRequest>()
                val days = validateDays(body.days, allowUnlimited = false)
                call.respondText("""{"success":${licenseManager.renew(license, days)}}""", ContentType.Application.Json)
            }

            // 清空绑定 IP 列表
            put("/license/{license}/ip") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@put
                val license = validateLicenseKey(call.parameters["license"])
                call.respondText("""{"success":${licenseManager.clearIps(license)}}""", ContentType.Application.Json)
            }

            get("/stats") {
                if (!checkAdmin(call, adminKey, securitySettings, adminRateLimiter)) return@get
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

private val responseJson = kotlinx.serialization.json.Json { encodeDefaults = true }
private val licenseKeyPattern = Regex("^[A-Za-z0-9_-]{8,128}$")

private fun licenseToJson(entry: LicenseEntry, online: Boolean, onlineCount: Int = 0): String {
    return responseJson.encodeToString(LicenseResponse.serializer(), LicenseResponse(
        license = entry.license,
        owner = entry.owner,
        serverKey = entry.serverKey,
        enabled = entry.enabled,
        online = online,
        onlineCount = onlineCount,
        createdAt = entry.createdAt,
        expiresAt = entry.expiresAt,
        boundIps = entry.boundIps,
        remainingDays = entry.remainingDays()
    ))
}

private suspend fun checkAdmin(
    call: ApplicationCall,
    adminKey: String,
    securitySettings: SecuritySettings,
    rateLimiter: IpRateLimiter
): Boolean {
    val clientIp = resolveClientIp(
        remoteAddress = call.request.local.remoteAddress,
        forwardedHeader = call.request.header(HttpHeaders.Forwarded),
        xForwardedForHeader = call.request.header(HttpHeaders.XForwardedFor),
        trustedProxies = securitySettings.trustedProxies
    )
    val authorization = call.request.header(HttpHeaders.Authorization)
    val suppliedKey = authorization
        ?.takeIf { it.startsWith("Bearer ") }
        ?.substring(7)
        .orEmpty()
    if (constantTimeEquals(suppliedKey, adminKey)) return true

    // 只统计失败的认证尝试。Admin 页面会定时轮询多个受保护端点，
    // 若成功请求也计数会让合法管理员在一分钟内被自身轮询锁死。
    val rateLimit = rateLimiter.check(clientIp)
    if (!rateLimit.allowed) {
        call.response.header(HttpHeaders.RetryAfter, rateLimit.retryAfterSeconds.toString())
        call.respond(HttpStatusCode.TooManyRequests, ApiError("RATE_LIMITED", "认证失败次数过多，请稍后重试"))
        return false
    }

    call.application.log.warn(
        "admin_auth_failed clientIp={} method={} path={} reason={}",
        clientIp,
        call.request.httpMethod.value,
        call.request.path(),
        if (authorization == null) "missing_authorization" else "invalid_credential"
    )
    call.respond(HttpStatusCode.Unauthorized, ApiError("UNAUTHORIZED", "认证失败"))
    return false
}

private suspend fun checkLicense(call: ApplicationCall, licenseManager: LicenseManager): LicenseEntry? {
    val auth = call.request.header(HttpHeaders.Authorization)
        ?.takeIf { it.startsWith("Bearer ") }
        ?.substring(7)
        ?.trim()
        .orEmpty()
    if (auth.isEmpty()) {
        call.respond(HttpStatusCode.Unauthorized, ApiError("MISSING_AUTHORIZATION", "缺少 Authorization header"))
        return null
    }
    if (!licenseKeyPattern.matches(auth)) {
        call.respond(HttpStatusCode.Unauthorized, ApiError("INVALID_LICENSE", "License 无效"))
        return null
    }
    val entry = licenseManager.get(auth)
    if (entry == null) {
        call.respond(HttpStatusCode.Unauthorized, ApiError("INVALID_LICENSE", "License 不存在"))
        return null
    }
    return entry
}

internal fun validateOwner(rawOwner: String): String {
    val owner = rawOwner.trim()
    require(owner.isNotEmpty()) { "owner 不能为空" }
    require(owner.length <= 100) { "owner 长度不能超过 100" }
    require(owner.none { it.isISOControl() }) { "owner 不能包含控制字符" }
    return owner
}

internal fun validateDays(days: Int, allowUnlimited: Boolean): Int {
    val minimum = if (allowUnlimited) 0 else 1
    require(days in minimum..3650) { "days 必须在 $minimum..3650 范围内" }
    return days
}

internal fun validateLicenseKey(rawLicense: String?): String {
    val license = rawLicense?.trim().orEmpty()
    require(licenseKeyPattern.matches(license)) { "license 格式无效" }
    return license
}
