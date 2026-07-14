package com.orryx.editor.commercial

import com.orryx.editor.auth.AccountService
import com.orryx.editor.auth.InMemoryAccountStore
import com.orryx.editor.auth.InMemorySessionStore
import com.orryx.editor.auth.PasswordHasher
import com.orryx.editor.auth.SessionService
import com.orryx.editor.claim.ClaimService
import com.orryx.editor.claim.InMemoryCommercialTransactionStore
import com.orryx.editor.config.AccountWebConfig
import com.orryx.editor.config.CommercialFeatureConfig
import com.orryx.editor.entitlement.EntitlementService
import com.orryx.editor.entitlement.InMemoryEntitlementStore
import com.orryx.editor.wallet.InMemoryWalletStore
import com.orryx.editor.wallet.WalletService
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation as ServerContentNegotiation
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CommercialRoutesTest {
    @Test
    fun `account session uses cookies and csrf protects mutations`() = testApplication {
        val claims = InMemoryCommercialTransactionStore(setOf("license-12345678"))
        val services = CommercialServices(
            features = CommercialFeatureConfig(accountsEnabled = true),
            accountWeb = AccountWebConfig(Duration.ofHours(1), secureCookie = false, cookieDomain = null),
            accounts = AccountService(InMemoryAccountStore(), TestPasswordHasher),
            sessions = SessionService(InMemorySessionStore(), lifetime = Duration.ofHours(1)),
            claims = ClaimService(claims),
            entitlements = EntitlementService(InMemoryEntitlementStore()),
            wallets = WalletService(InMemoryWalletStore())
        )
        application {
            install(ServerContentNegotiation) { json() }
            routing { commercialRoutes(services) }
        }
        val browser = createClient {
            install(ContentNegotiation) { json() }
            install(HttpCookies)
        }

        val register = browser.post("/api/v2/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"owner@example.com","password":"password-123","displayName":"Owner"}""")
        }
        assertEquals(HttpStatusCode.Created, register.status)
        val setCookies = register.headers.getAll(HttpHeaders.SetCookie).orEmpty()
        assertTrue(setCookies.any { it.startsWith("orryx_session=") && "HttpOnly" in it })
        assertTrue(setCookies.any { it.startsWith("orryx_csrf=") && "HttpOnly" !in it })
        assertFalse(register.body<String>().contains("password-123"))

        assertEquals(HttpStatusCode.OK, browser.get("/api/v2/auth/me").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            browser.post("/api/v2/licenses/claim") {
                contentType(ContentType.Application.Json)
                setBody("""{"license":"license-12345678"}""")
            }.status
        )

        val csrf = setCookies.firstOrNull { it.startsWith("orryx_csrf=") }
            ?.substringAfter("orryx_csrf=")
            ?.substringBefore(';')
        assertNotNull(csrf)
        val claimed = browser.post("/api/v2/licenses/claim") {
            contentType(ContentType.Application.Json)
            header("X-CSRF-Token", csrf)
            setBody("""{"license":"license-12345678"}""")
        }
        assertEquals(HttpStatusCode.OK, claimed.status)
        assertTrue(claimed.body<String>().contains("CLAIMED"))

        val logout = browser.post("/api/v2/auth/logout") { header("X-CSRF-Token", csrf) }
        assertEquals(HttpStatusCode.NoContent, logout.status)
        assertEquals(HttpStatusCode.Unauthorized, browser.get("/api/v2/auth/me").status)
    }

    private object TestPasswordHasher : PasswordHasher {
        override fun hash(password: CharArray): String = "test:${password.concatToString()}"
        override fun verify(password: CharArray, encodedHash: String): Boolean = encodedHash == hash(password)
    }
}
