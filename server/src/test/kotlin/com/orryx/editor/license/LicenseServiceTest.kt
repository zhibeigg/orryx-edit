package com.orryx.editor.license

import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LicenseServiceTest {
    private val now = Instant.parse("2025-01-01T00:00:00Z")

    @Test
    fun `validates enabled expiration and bound ip`() = runTest {
        val repository = InMemoryLicenseRepository()
        val service = service(repository)
        val license = service.create(CreateLicenseCommand("owner", days = 30, maxBoundIps = 1))

        assertNotNull(service.validate(license.license))
        assertEquals(AddIpResult.ADDED, service.addIp(license.license, "127.0.0.1"))
        assertNotNull(service.validate(license.license, "127.0.0.1"))
        assertNull(service.validate(license.license, "127.0.0.2"))
        assertTrue(service.revoke(license.license))
        assertNull(service.validate(license.license))
        assertTrue(service.enable(license.license))
        assertNotNull(service.validate(license.license))
    }

    @Test
    fun `editor access ignores expiration but still enforces revocation and bound ip`() = runTest {
        val repository = InMemoryLicenseRepository()
        val activeService = service(repository)
        val license = activeService.create(CreateLicenseCommand("owner", days = 1, maxBoundIps = 1))
        assertEquals(AddIpResult.ADDED, activeService.addIp(license.license, "127.0.0.1"))

        val expiredService = service(repository, now.plusSeconds(2 * 86_400L))
        assertNull(expiredService.validate(license.license, "127.0.0.1"))
        assertNotNull(expiredService.validateEditorAccess(license.license, "127.0.0.1"))
        assertNull(expiredService.validateEditorAccess(license.license, "127.0.0.2"))
        assertNull(expiredService.validateEditorAccess(license.license, "not-an-ip"))
        assertNull(expiredService.validateEditorAccess("missing-license", "127.0.0.1"))

        assertTrue(expiredService.revoke(license.license))
        assertNull(expiredService.validateEditorAccess(license.license, "127.0.0.1"))
    }

    @Test
    fun `enforces ip upper limit transactionally`() = runTest {
        val service = service(InMemoryLicenseRepository())
        val license = service.create(CreateLicenseCommand("owner", maxBoundIps = 1))

        assertEquals(AddIpResult.ADDED, service.addIp(license.license, "192.0.2.10"))
        assertEquals(AddIpResult.ALREADY_BOUND, service.addIp(license.license, "192.0.2.10"))
        assertEquals(AddIpResult.LIMIT_REACHED, service.addIp(license.license, "192.0.2.11"))
        assertEquals(listOf("192.0.2.10"), service.get(license.license)?.boundIps)
    }

    @Test
    fun `renew extends from current future expiry`() = runTest {
        val service = service(InMemoryLicenseRepository())
        val license = service.create(CreateLicenseCommand("owner", days = 10))
        assertTrue(service.renew(license.license, 5))
        assertEquals(now.plusSeconds(15 * 86_400L), service.get(license.license)?.expiresAt)
        assertFalse(service.renew("missing", 5))
    }

    private fun service(repository: LicenseRepository, instant: Instant = now): LicenseService = LicenseService(
        repository = repository,
        clock = Clock.fixed(instant, ZoneOffset.UTC),
        licenseKeyGenerator = { "license-key-00000001" },
        serverKeyGenerator = { "server-key-0000000000000000000001" }
    )
}
