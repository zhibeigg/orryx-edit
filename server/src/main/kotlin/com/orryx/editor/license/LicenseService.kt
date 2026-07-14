package com.orryx.editor.license

import com.orryx.editor.security.normalizeIpAddress
import java.security.SecureRandom
import java.time.Clock
import java.time.temporal.ChronoUnit

class LicenseService(
    private val repository: LicenseRepository,
    private val clock: Clock = Clock.systemUTC(),
    private val licenseKeyGenerator: () -> String = { randomHex(20) },
    private val serverKeyGenerator: () -> String = { randomHex(32) }
) {
    suspend fun create(command: CreateLicenseCommand): License {
        val owner = command.owner.trim()
        require(owner.isNotEmpty()) { "owner 不能为空" }
        require(owner.length <= 100) { "owner 长度不能超过 100" }
        require(command.days in 0..3650) { "days 必须在 0..3650 范围内" }
        require(command.maxBoundIps in 0..100) { "maxBoundIps 必须在 0..100 范围内" }
        val now = clock.instant()
        return repository.create(
            License(
                license = licenseKeyGenerator(),
                owner = owner,
                createdAt = now,
                expiresAt = command.days.takeIf { it > 0 }?.let { now.plus(it.toLong(), ChronoUnit.DAYS) },
                boundIps = emptyList(),
                serverKey = serverKeyGenerator(),
                enabled = true,
                maxBoundIps = command.maxBoundIps,
                updatedAt = now
            )
        )
    }

    suspend fun validate(licenseKey: String, connectIp: String = ""): License? {
        val license = repository.find(licenseKey) ?: return null
        if (!license.enabled || license.isExpired(clock)) return null
        val normalizedIp = if (connectIp.isBlank()) "" else normalizeIpAddress(connectIp) ?: return null
        return license.takeIf { it.isIpAllowed(normalizedIp) }
    }

    /** Editor relay 使用 License 作为服务器身份凭据，到期不影响实时编辑器访问。 */
    suspend fun validateEditorAccess(licenseKey: String, connectIp: String = ""): License? {
        val license = repository.find(licenseKey) ?: return null
        if (!license.enabled) return null
        val normalizedIp = if (connectIp.isBlank()) "" else normalizeIpAddress(connectIp) ?: return null
        return license.takeIf { it.isIpAllowed(normalizedIp) }
    }

    suspend fun get(licenseKey: String): License? = repository.find(licenseKey)
    suspend fun list(): List<License> = repository.list()

    suspend fun renew(licenseKey: String, days: Int): Boolean {
        require(days in 1..3650) { "days 必须在 1..3650 范围内" }
        return repository.renew(licenseKey, days, clock.instant()) != null
    }

    suspend fun revoke(licenseKey: String): Boolean = repository.setEnabled(licenseKey, false, clock.instant())
    suspend fun enable(licenseKey: String): Boolean = repository.setEnabled(licenseKey, true, clock.instant())

    suspend fun addIp(licenseKey: String, ip: String): AddIpResult {
        val normalized = normalizeIpAddress(ip) ?: return AddIpResult.LICENSE_NOT_FOUND
        return repository.addBoundIp(licenseKey, normalized, clock.instant())
    }

    suspend fun removeIp(licenseKey: String, ip: String): Boolean {
        val normalized = normalizeIpAddress(ip) ?: return false
        return repository.removeBoundIp(licenseKey, normalized, clock.instant())
    }

    suspend fun clearIps(licenseKey: String): Boolean = repository.clearBoundIps(licenseKey, clock.instant())
}

private val secureRandom = SecureRandom()
private val hex = "0123456789abcdef"

private fun randomHex(length: Int): String = buildString(length) {
    repeat(length) { append(hex[secureRandom.nextInt(hex.length)]) }
}
