package com.orryx.editor.license

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.temporal.ChronoUnit

class InMemoryLicenseRepository : LicenseRepository {
    private val mutex = Mutex()
    private val licenses = linkedMapOf<String, License>()

    override suspend fun create(license: License): License = mutex.withLock {
        check(licenses.putIfAbsent(license.license, license) == null) { "license 已存在" }
        license
    }

    override suspend fun find(licenseKey: String): License? = mutex.withLock { licenses[licenseKey] }

    override suspend fun list(): List<License> = mutex.withLock { licenses.values.toList() }

    override suspend fun renew(licenseKey: String, days: Int, now: Instant): License? = mutex.withLock {
        val current = licenses[licenseKey] ?: return@withLock null
        val base = current.expiresAt?.takeIf { it.isAfter(now) } ?: now
        current.copy(expiresAt = base.plus(days.toLong(), ChronoUnit.DAYS), updatedAt = now)
            .also { licenses[licenseKey] = it }
    }

    override suspend fun setEnabled(licenseKey: String, enabled: Boolean, now: Instant): Boolean = mutex.withLock {
        val current = licenses[licenseKey] ?: return@withLock false
        licenses[licenseKey] = current.copy(enabled = enabled, updatedAt = now)
        true
    }

    override suspend fun addBoundIp(licenseKey: String, ip: String, now: Instant): AddIpResult = mutex.withLock {
        val current = licenses[licenseKey] ?: return@withLock AddIpResult.LICENSE_NOT_FOUND
        if (ip in current.boundIps) return@withLock AddIpResult.ALREADY_BOUND
        if (current.boundIps.size >= current.maxBoundIps) return@withLock AddIpResult.LIMIT_REACHED
        licenses[licenseKey] = current.copy(boundIps = current.boundIps + ip, updatedAt = now)
        AddIpResult.ADDED
    }

    override suspend fun removeBoundIp(licenseKey: String, ip: String, now: Instant): Boolean = mutex.withLock {
        val current = licenses[licenseKey] ?: return@withLock false
        licenses[licenseKey] = current.copy(boundIps = current.boundIps - ip, updatedAt = now)
        true
    }

    override suspend fun clearBoundIps(licenseKey: String, now: Instant): Boolean = mutex.withLock {
        val current = licenses[licenseKey] ?: return@withLock false
        licenses[licenseKey] = current.copy(boundIps = emptyList(), updatedAt = now)
        true
    }
}
