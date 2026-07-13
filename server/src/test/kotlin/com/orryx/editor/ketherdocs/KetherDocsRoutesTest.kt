package com.orryx.editor.ketherdocs

import com.orryx.editor.license.InMemoryLicenseRepository
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.license.LicenseService
import com.orryx.editor.plugins.configureRouting
import com.orryx.editor.relay.SessionRegistry
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KetherDocsRoutesTest {
    @Test
    fun `public schema route serves verified active cache with etag`() = runTest {
        val config = KetherDocsConfig.fromEnvironment(emptyMap())
        val validator = KetherDocsValidator(config)
        val service = KetherDocsService(
            config = config,
            repository = InMemoryKetherDocsRepository(),
            source = StubKetherDocsUpstream(Result.success(validFetchedSchema())),
            validator = validator,
            bundledLoader = { validator.validateBundled(validSchemaBytes()) }
        )
        service.initialize()

        testApplication {
            application {
                configureRouting(
                    licenseManager = LicenseManager(LicenseService(InMemoryLicenseRepository())),
                    registry = SessionRegistry(),
                    adminKey = "0123456789abcdef",
                    ketherDocsService = service
                )
            }

            val response = client.get("/api/actions-schema")
            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("bundled", response.headers["X-Orryx-Kether-Source"])
            assertTrue(response.bodyAsText().contains("\"schemaVersion\": 3"))
            val etag = assertNotNull(response.headers[HttpHeaders.ETag])
            assertEquals(
                HttpStatusCode.NotModified,
                client.get("/actions-schema.json") { header(HttpHeaders.IfNoneMatch, etag) }.status
            )

            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/admin/kether-docs/status").status)
            assertEquals(
                HttpStatusCode.OK,
                client.get("/api/admin/kether-docs/status") {
                    header(HttpHeaders.Authorization, "Bearer 0123456789abcdef")
                }.status
            )
        }
    }
}
