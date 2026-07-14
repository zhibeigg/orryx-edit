package com.orryx.editor.license

import kotlinx.serialization.Serializable
import java.io.File
import java.time.Clock

@Serializable
data class LicenseEntry(
    val license: String,
    val owner: String,
    val createdAt: Long,
    val expiresAt: Long = 0L,
    val boundIps: List<String> = emptyList(),
    val serverKey: String,
    val enabled: Boolean = true,
    val maxServers: Int = 1
) {
    fun isExpired(): Boolean = expiresAt > 0 && System.currentTimeMillis() >= expiresAt

    fun remainingDays(): Long {
        if (expiresAt <= 0) return -1
        val remaining = expiresAt - System.currentTimeMillis()
        return if (remaining > 0) remaining / 86_400_000 else 0
    }

    fun isIpAllowed(ip: String): Boolean = boundIps.isEmpty() || ip.isEmpty() || ip in boundIps
}

/**
 * 兼容现有 HTTP/WebSocket 调用的挂起 facade。
 *
 * 生产环境必须显式传入基于 PostgreSQL 的 [LicenseService]；File 构造器仅保留到主线完成接线，
 * 不会读取 JSON，也不会回退到内存持久化。
 */
class LicenseManager(
    private val service: LicenseService,
    private val clock: Clock = Clock.systemUTC()
) {
    @Deprecated("主线需改为注入 LicenseService(PostgresLicenseRepository(database))")
    constructor(@Suppress("UNUSED_PARAMETER") dataDir: File) : this(
        LicenseService(UnconfiguredLicenseRepository)
    )

    suspend fun createLicense(owner: String, days: Int = 0, maxServers: Int = 1): LicenseEntry =
        service.create(CreateLicenseCommand(owner = owner, days = days, maxBoundIps = maxServers)).toEntry()

    suspend fun validate(license: String, connectIp: String = ""): LicenseEntry? =
        service.validate(license, connectIp)?.toEntry()

    suspend fun validateEditorAccess(license: String, connectIp: String = ""): LicenseEntry? =
        service.validateEditorAccess(license, connectIp)?.toEntry()

    suspend fun renew(license: String, days: Int): Boolean = service.renew(license, days)

    suspend fun addIp(license: String, ip: String): Boolean = when (service.addIp(license, ip)) {
        AddIpResult.ADDED, AddIpResult.ALREADY_BOUND -> true
        AddIpResult.LICENSE_NOT_FOUND, AddIpResult.LIMIT_REACHED -> false
    }

    suspend fun removeIp(license: String, ip: String): Boolean = service.removeIp(license, ip)
    suspend fun clearIps(license: String): Boolean = service.clearIps(license)
    suspend fun revoke(license: String): Boolean = service.revoke(license)
    suspend fun enable(license: String): Boolean = service.enable(license)
    suspend fun get(license: String): LicenseEntry? = service.get(license)?.toEntry()
    suspend fun list(): List<LicenseEntry> = service.list().map { it.toEntry() }

    fun shutdown() = Unit

    private fun License.toEntry(): LicenseEntry = LicenseEntry(
        license = license,
        owner = owner,
        createdAt = createdAt.toEpochMilli(),
        expiresAt = expiresAt?.toEpochMilli() ?: 0L,
        boundIps = boundIps,
        serverKey = serverKey,
        enabled = enabled,
        maxServers = maxBoundIps
    )
}

private object UnconfiguredLicenseRepository : LicenseRepository {
    private fun unavailable(): Nothing = throw IllegalStateException(
        "PostgreSQL 持久层尚未接线：请注入 LicenseService(PostgresLicenseRepository(database))"
    )

    override suspend fun create(license: License): License = unavailable()
    override suspend fun find(licenseKey: String): License? = unavailable()
    override suspend fun list(): List<License> = unavailable()
    override suspend fun renew(licenseKey: String, days: Int, now: java.time.Instant): License? = unavailable()
    override suspend fun setEnabled(licenseKey: String, enabled: Boolean, now: java.time.Instant): Boolean = unavailable()
    override suspend fun addBoundIp(licenseKey: String, ip: String, now: java.time.Instant): AddIpResult = unavailable()
    override suspend fun removeBoundIp(licenseKey: String, ip: String, now: java.time.Instant): Boolean = unavailable()
    override suspend fun clearBoundIps(licenseKey: String, now: java.time.Instant): Boolean = unavailable()
}
