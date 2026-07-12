package com.orryx.editor.plugins

import com.orryx.editor.license.LicenseManager
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.IpRateLimiter
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.parseCorsOrigins
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutingSecurityTest {
    private val adminKey = "0123456789abcdef"

    @Test
    fun `cors is disabled by default and enabled only for configured origin`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-cors-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(manager, SessionRegistry(), adminKey)
            }
            val noCorsResponse = client.options("/api/admin/stats") {
                header(HttpHeaders.Origin, "https://editor.example.com")
                header(HttpHeaders.AccessControlRequestMethod, HttpMethod.Get.value)
            }
            assertNull(noCorsResponse.headers[HttpHeaders.AccessControlAllowOrigin])
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `configured cors origin is exact and does not enable credentials`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-cors-enabled-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(
                    manager,
                    SessionRegistry(),
                    adminKey,
                    SecuritySettings(corsOrigins = parseCorsOrigins("https://editor.example.com"))
                )
            }
            val response = client.options("/api/admin/stats") {
                header(HttpHeaders.Origin, "https://editor.example.com")
                header(HttpHeaders.AccessControlRequestMethod, HttpMethod.Get.value)
            }
            assertEquals("https://editor.example.com", response.headers[HttpHeaders.AccessControlAllowOrigin])
            assertNull(response.headers[HttpHeaders.AccessControlAllowCredentials])
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `security headers are present and hsts is opt in`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-headers-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(manager, SessionRegistry(), adminKey)
            }
            val response = client.get("/api/admin/stats")
            assertNotNull(response.headers["Content-Security-Policy"])
            assertEquals("nosniff", response.headers["X-Content-Type-Options"])
            assertEquals("strict-origin-when-cross-origin", response.headers["Referrer-Policy"])
            assertEquals("DENY", response.headers["X-Frame-Options"])
            assertNull(response.headers["Strict-Transport-Security"])
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `hsts header appears only when explicitly enabled`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-hsts-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(
                    manager,
                    SessionRegistry(),
                    adminKey,
                    SecuritySettings(hstsEnabled = true)
                )
            }
            val response = client.get("/api/admin/stats")
            assertEquals("max-age=31536000", response.headers["Strict-Transport-Security"])
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `admin rate limit returns 429 and retry after`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-rate-limit-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(
                    manager,
                    SessionRegistry(),
                    adminKey,
                    adminRateLimiter = IpRateLimiter(limit = 1, windowMillis = 60_000, staleAfterMillis = 60_000)
                )
            }
            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/admin/stats").status)
            val limited = client.get("/api/admin/stats")
            assertEquals(HttpStatusCode.TooManyRequests, limited.status)
            assertNotNull(limited.headers[HttpHeaders.RetryAfter])
            assertTrue(limited.bodyAsText().contains("RATE_LIMITED"))
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }

    @Test
    fun `invalid management owner returns stable error`() = testApplication {
        val dataDir = Files.createTempDirectory("orryx-validation-test")
        val manager = LicenseManager(dataDir.toFile())
        try {
            application {
                configureRouting(manager, SessionRegistry(), adminKey)
            }
            val response = client.post("/api/admin/license") {
                header(HttpHeaders.Authorization, "Bearer $adminKey")
                contentType(ContentType.Application.Json)
                setBody("""{"owner":"   ","days":30}""")
            }
            assertEquals(HttpStatusCode.BadRequest, response.status)
            val body = response.bodyAsText()
            assertTrue(body.contains("INVALID_INPUT"))
            assertFalse(body.contains("Exception"))
        } finally {
            manager.shutdown()
            dataDir.toFile().deleteRecursively()
        }
    }
}
