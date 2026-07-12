package com.orryx.editor.license

import java.time.Instant

interface LicenseRepository {
    suspend fun create(license: License): License
    suspend fun find(licenseKey: String): License?
    suspend fun list(): List<License>
    suspend fun renew(licenseKey: String, days: Int, now: Instant): License?
    suspend fun setEnabled(licenseKey: String, enabled: Boolean, now: Instant): Boolean
    suspend fun addBoundIp(licenseKey: String, ip: String, now: Instant): AddIpResult
    suspend fun removeBoundIp(licenseKey: String, ip: String, now: Instant): Boolean
    suspend fun clearBoundIps(licenseKey: String, now: Instant): Boolean
}
