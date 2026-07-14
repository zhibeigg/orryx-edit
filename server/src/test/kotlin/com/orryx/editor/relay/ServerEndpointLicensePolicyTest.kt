package com.orryx.editor.relay

import com.orryx.editor.license.AddIpResult
import com.orryx.editor.license.CreateLicenseCommand
import com.orryx.editor.license.InMemoryLicenseRepository
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.license.LicenseService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ServerEndpointLicensePolicyTest {
    private val now = Instant.parse("2025-01-01T00:00:00Z")

    @Test
    fun `expired enabled license can register editor server`() = runBlocking {
        val repository = InMemoryLicenseRepository()
        val activeService = service(repository, now)
        val license = activeService.create(CreateLicenseCommand("owner", days = 1))
        val endpoint = ServerEndpoint(
            SessionRegistry(),
            LicenseManager(service(repository, now.plusSeconds(2 * 86_400L)))
        )
        val plugin = FakeSocket()

        endpoint.handleServerMessage(plugin, registerMessage("expired-register", license.license))

        val result = resultData(plugin)
        assertEquals(true, result["success"]?.jsonPrimitive?.booleanOrNull)
        assertTrue(result["workspaceId"]?.jsonPrimitive?.contentOrNull != null)
    }

    @Test
    fun `expired license with mismatched bound ip returns ip error`() = runBlocking {
        val repository = InMemoryLicenseRepository()
        val activeService = service(repository, now)
        val license = activeService.create(CreateLicenseCommand("owner", days = 1, maxBoundIps = 1))
        assertEquals(AddIpResult.ADDED, activeService.addIp(license.license, "203.0.113.10"))
        val endpoint = ServerEndpoint(
            SessionRegistry(),
            LicenseManager(service(repository, now.plusSeconds(2 * 86_400L)))
        )
        val plugin = FakeSocket()
        endpoint.onServerConnect(plugin, "203.0.113.11")

        endpoint.handleServerMessage(plugin, registerMessage("ip-register", license.license))

        val result = resultData(plugin)
        assertEquals(false, result["success"]?.jsonPrimitive?.booleanOrNull)
        assertEquals("IP_NOT_ALLOWED", result["code"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `disabled and missing licenses remain rejected`() = runBlocking {
        val repository = InMemoryLicenseRepository()
        val activeService = service(repository, now)
        val license = activeService.create(CreateLicenseCommand("owner", days = 1))
        assertTrue(activeService.revoke(license.license))
        val endpoint = ServerEndpoint(
            SessionRegistry(),
            LicenseManager(service(repository, now.plusSeconds(2 * 86_400L)))
        )
        val disabledPlugin = FakeSocket()
        val missingPlugin = FakeSocket()

        endpoint.handleServerMessage(disabledPlugin, registerMessage("disabled-register", license.license))
        endpoint.handleServerMessage(missingPlugin, registerMessage("missing-register", "missing-license-key"))

        assertEquals("LICENSE_DISABLED", resultData(disabledPlugin)["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals("LICENSE_NOT_FOUND", resultData(missingPlugin)["code"]?.jsonPrimitive?.contentOrNull)
    }

    private fun service(repository: InMemoryLicenseRepository, instant: Instant): LicenseService = LicenseService(
        repository = repository,
        clock = Clock.fixed(instant, ZoneOffset.UTC),
        licenseKeyGenerator = { "license-key-00000001" },
        serverKeyGenerator = { "server-key-0000000000000000000001" }
    )

    private fun registerMessage(id: String, license: String): String =
        """{"type":"server.register","id":"$id","data":{"license":"$license","serverName":"test-server"}}"""

    private fun resultData(socket: FakeSocket) =
        Json.parseToJsonElement(socket.messages.single()).jsonObject.getValue("data").jsonObject

    private class FakeSocket : RelaySocket {
        val messages = mutableListOf<String>()

        override suspend fun sendText(text: String) {
            messages += text
        }
    }
}
