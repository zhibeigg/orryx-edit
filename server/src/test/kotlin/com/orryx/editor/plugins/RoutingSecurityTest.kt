package com.orryx.editor.plugins

import com.orryx.editor.license.InMemoryLicenseRepository
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.license.LicenseService
import com.orryx.editor.relay.SessionRegistry
import com.orryx.editor.security.IpRateLimiter
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.parseCorsOrigins
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutingSecurityTest {
    private val adminKey = "0123456789abcdef"

    private fun manager() = LicenseManager(LicenseService(InMemoryLicenseRepository()))

    @Test
    fun `cors is disabled by default and enabled only for configured origin`() = testApplication {
        application { configureRouting(manager(), SessionRegistry(), adminKey) }
        val response = client.options("/api/admin/stats") {
            header(HttpHeaders.Origin, "https://editor.example.com")
            header(HttpHeaders.AccessControlRequestMethod, HttpMethod.Get.value)
        }
        assertNull(response.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `configured cors origin is exact and does not enable credentials`() = testApplication {
        application {
            configureRouting(
                manager(),
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
    }

    @Test
    fun `security headers are present and hsts is opt in`() = testApplication {
        application { configureRouting(manager(), SessionRegistry(), adminKey) }
        val response = client.get("/api/admin/stats")
        assertNotNull(response.headers["Content-Security-Policy"])
        assertEquals("nosniff", response.headers["X-Content-Type-Options"])
        assertEquals("strict-origin-when-cross-origin", response.headers["Referrer-Policy"])
        assertEquals("DENY", response.headers["X-Frame-Options"])
        assertNull(response.headers["Strict-Transport-Security"])
    }

    @Test
    fun `hsts header appears only when explicitly enabled`() = testApplication {
        application {
            configureRouting(
                manager(),
                SessionRegistry(),
                adminKey,
                SecuritySettings(hstsEnabled = true)
            )
        }
        val response = client.get("/api/admin/stats")
        assertEquals("max-age=31536000", response.headers["Strict-Transport-Security"])
    }

    @Test
    fun `admin rate limit returns 429 and retry after`() = testApplication {
        application {
            configureRouting(
                manager(),
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
    }

    @Test
    fun `account cookie never grants admin access and disabled commercial routes are unreachable`() = testApplication {
        application { configureRouting(manager(), SessionRegistry(), adminKey) }
        val admin = client.get("/api/admin/stats") {
            header(HttpHeaders.Cookie, "orryx_session=account-session; orryx_csrf=csrf")
        }
        assertEquals(HttpStatusCode.Unauthorized, admin.status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/admin/commercial/orders").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v2/ai/providers").status)
    }

    @Test
    fun `invalid management owner returns stable error`() = testApplication {
        application { configureRouting(manager(), SessionRegistry(), adminKey) }
        val response = client.post("/api/admin/license") {
            header(HttpHeaders.Authorization, "Bearer $adminKey")
            contentType(ContentType.Application.Json)
            setBody("""{"owner":"   ","days":30}""")
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("INVALID_INPUT"))
        assertFalse(body.contains("Exception"))
    }
}
