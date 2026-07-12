package com.orryx.editor.plugins

import com.orryx.editor.audit.AuditEvent
import com.orryx.editor.audit.AuditRepository
import com.orryx.editor.build.BuildInfo
import com.orryx.editor.license.LicenseEntry
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.IpRateLimiter
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.constantTimeEquals
import com.orryx.editor.security.resolveClientIp
import com.orryx.editor.update.UpdateService
import com.orryx.editor.update.updateAdminRoutes
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

@Serializable
data class CreateLicenseRequest(val owner: String, val days: Int = 30, val maxServers: Int = 1)

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
    val maxServers: Int,
    val remainingDays: Long
)

@Serializable
data class ApiError(val code: String, val message: String, val error: String = message)

@Serializable
private data class SuccessResponse(val success: Boolean)

@Serializable
private data class StatsResponse(val servers: Int, val browsers: Int, val tokens: Int, val licenses: Int)

@Serializable
private data class HealthResponse(val status: String, val version: String)

@Serializable
private data class BuildInfoResponse(
    val version: String,
    val commit: String,
    val buildType: String,
    val deployment: String,
    val databaseSchemaVersion: Long
)

fun Application.configureRouting(
    licenseManager: LicenseManager,
    registry: SessionRegistry,
    adminKey: String,
    securitySettings: SecuritySettings = SecuritySettings(),
    adminRateLimiter: IpRateLimiter = IpRateLimiter(),
    auditRepository: AuditRepository? = null,
    buildInfo: BuildInfo = BuildInfo("unknown", "source", false),
    readinessCheck: suspend () -> Boolean = { true },
    updateService: UpdateService? = null
) {
    install(ContentNegotiation) { json() }

    install(DefaultHeaders) {
        header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; form-action 'self'")
        header("X-Content-Type-Options", "nosniff")
        header("Referrer-Policy", "strict-origin-when-cross-origin")
        header("X-Frame-Options", "DENY")
        if (securitySettings.hstsEnabled) header("Strict-Transport-Security", "max-age=31536000")
    }

    if (securitySettings.corsOrigins.isNotEmpty()) {
        install(CORS) {
            securitySettings.corsOrigins.forEach { origin -> allowHost(origin.ktorHost, schemes = listOf(origin.scheme)) }
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
            call.application.log.error(
                "request_failed method={} path={} type={}",
                call.request.httpMethod.value,
                call.request.path(),
                exception::class.simpleName
            )
            call.respond(HttpStatusCode.InternalServerError, ApiError("INTERNAL_ERROR", "服务器内部错误"))
        }
    }

    routing {
        get("/health/live") {
            call.respond(HealthResponse("UP", buildInfo.version))
        }
        get("/health/ready") {
            if (readinessCheck()) call.respond(HealthResponse("UP", buildInfo.version))
            else call.respond(HttpStatusCode.ServiceUnavailable, HealthResponse("NOT_READY", buildInfo.version))
        }

        staticResources("/", "static") { default("index.html") }
        get("/api/actions-schema") { call.respondRedirect("/actions-schema.json", permanent = false) }

        route("/api/admin") {
            suspend fun authorized(call: ApplicationCall): Boolean = checkAdmin(
                call,
                adminKey,
                securitySettings,
                adminRateLimiter,
                auditRepository
            )

            post("/license") {
                if (!authorized(call)) return@post
                val body = call.receive<CreateLicenseRequest>()
                val entry = licenseManager.createLicense(
                    owner = validateOwner(body.owner),
                    days = validateDays(body.days, allowUnlimited = true),
                    maxServers = validateMaxServers(body.maxServers)
                )
                recordAudit(auditRepository, "license.created", "admin", maskedLicense(entry.license))
                call.respond(entry.toResponse(false, 0))
            }

            get("/licenses") {
                if (!authorized(call)) return@get
                val onlineKeys = registry.getOnlineServerKeys()
                call.respond(licenseManager.list().map { entry ->
                    entry.toResponse(entry.serverKey in onlineKeys, registry.onlineSessionCount(entry.serverKey))
                })
            }

            delete("/license/{license}") {
                if (!authorized(call)) return@delete
                val license = validateLicenseKey(call.parameters["license"])
                val success = licenseManager.revoke(license)
                if (success) recordAudit(auditRepository, "license.revoked", "admin", maskedLicense(license))
                call.respond(SuccessResponse(success))
            }

            put("/license/{license}") {
                if (!authorized(call)) return@put
                val license = validateLicenseKey(call.parameters["license"])
                val success = licenseManager.enable(license)
                if (success) recordAudit(auditRepository, "license.enabled", "admin", maskedLicense(license))
                call.respond(SuccessResponse(success))
            }

            post("/license/{license}/renew") {
                if (!authorized(call)) return@post
                val license = validateLicenseKey(call.parameters["license"])
                val days = validateDays(call.receive<RenewRequest>().days, allowUnlimited = false)
                val success = licenseManager.renew(license, days)
                if (success) recordAudit(
                    auditRepository,
                    "license.renewed",
                    "admin",
                    maskedLicense(license),
                    buildJsonObject { put("days", days) }.toString()
                )
                call.respond(SuccessResponse(success))
            }

            put("/license/{license}/ip") {
                if (!authorized(call)) return@put
                val license = validateLicenseKey(call.parameters["license"])
                val success = licenseManager.clearIps(license)
                if (success) recordAudit(auditRepository, "license.ips_cleared", "admin", maskedLicense(license))
                call.respond(SuccessResponse(success))
            }

            get("/stats") {
                if (!authorized(call)) return@get
                call.respond(
                    StatsResponse(
                        servers = registry.serverCount(),
                        browsers = registry.browserCount(),
                        tokens = registry.tokenCount(),
                        licenses = licenseManager.list().size
                    )
                )
            }

            get("/system/version") {
                if (!authorized(call)) return@get
                call.respond(buildInfo.toResponse())
            }

            updateService?.let { service ->
                updateAdminRoutes(service, ::authorized)
                route("/system") { updateAdminRoutes(service, ::authorized) }
            }
        }

        route("/api/license") {
            get("/info") {
                val entry = checkLicense(call, licenseManager) ?: return@get
                call.respond(entry.toResponse(registry.isServerOnline(entry.serverKey), registry.onlineSessionCount(entry.serverKey)))
            }

            delete("/ip") {
                val entry = checkLicense(call, licenseManager) ?: return@delete
                val success = licenseManager.clearIps(entry.license)
                if (success) recordAudit(auditRepository, "license.ips_cleared", "license", maskedLicense(entry.license))
                call.respond(SuccessResponse(success))
            }
        }

        for (spaPath in listOf("/admin", "/portal")) {
            get(spaPath) {
                val resource = call.resolveResource("static/index.html")
                if (resource != null) call.respond(resource)
                else call.respondText("Not Found", status = HttpStatusCode.NotFound)
            }
        }
    }
}

private val licenseKeyPattern = Regex("^[A-Za-z0-9_-]{8,128}$")

private fun LicenseEntry.toResponse(online: Boolean, onlineCount: Int) = LicenseResponse(
    license = license,
    owner = owner,
    serverKey = serverKey,
    enabled = enabled,
    online = online,
    onlineCount = onlineCount,
    createdAt = createdAt,
    expiresAt = expiresAt,
    boundIps = boundIps,
    maxServers = maxServers,
    remainingDays = remainingDays()
)

private fun BuildInfo.toResponse() = BuildInfoResponse(version, commit, buildType, deployment, databaseSchemaVersion)

private suspend fun checkAdmin(
    call: ApplicationCall,
    adminKey: String,
    securitySettings: SecuritySettings,
    rateLimiter: IpRateLimiter,
    auditRepository: AuditRepository?
): Boolean {
    val clientIp = resolveClientIp(
        remoteAddress = call.request.local.remoteAddress,
        forwardedHeader = call.request.header(HttpHeaders.Forwarded),
        xForwardedForHeader = call.request.header(HttpHeaders.XForwardedFor),
        trustedProxies = securitySettings.trustedProxies
    )
    val authorization = call.request.header(HttpHeaders.Authorization)
    val suppliedKey = authorization?.takeIf { it.startsWith("Bearer ") }?.substring(7).orEmpty()
    if (constantTimeEquals(suppliedKey, adminKey)) return true

    val rateLimit = rateLimiter.check(clientIp)
    if (!rateLimit.allowed) {
        recordAudit(auditRepository, "admin.auth_failed", "remote:$clientIp", call.request.path(), "{\"reason\":\"rate_limited\"}")
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
    recordAudit(auditRepository, "admin.auth_failed", "remote:$clientIp", call.request.path())
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
    val raw = licenseManager.get(auth)
    if (raw == null) {
        call.respond(HttpStatusCode.Unauthorized, ApiError("INVALID_LICENSE", "License 不存在"))
        return null
    }
    val active = licenseManager.validate(auth)
    if (active == null) {
        call.respond(HttpStatusCode.Forbidden, ApiError("LICENSE_INACTIVE", "License 已禁用或过期"))
        return null
    }
    return active
}

private suspend fun recordAudit(
    repository: AuditRepository?,
    eventType: String,
    actor: String?,
    subject: String?,
    detailsJson: String = "{}"
) {
    if (repository == null) return
    try {
        repository.append(AuditEvent(eventType = eventType, actor = actor, subject = subject, detailsJson = detailsJson, createdAt = Instant.now()))
    } catch (_: Exception) {
        // 审计写入失败不能泄露细节或改变原业务响应；数据库错误仍会由健康检查暴露为 not-ready。
    }
}

private fun maskedLicense(license: String): String = "license:***${license.takeLast(6)}"

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

internal fun validateMaxServers(maxServers: Int): Int {
    require(maxServers in 1..100) { "maxServers 必须在 1..100 范围内" }
    return maxServers
}

internal fun validateLicenseKey(rawLicense: String?): String {
    val license = rawLicense?.trim().orEmpty()
    require(licenseKeyPattern.matches(license)) { "license 格式无效" }
    return license
}
