package com.orryx.editor.update

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class GitHubReleaseClientTest {
    @Test fun `draft and prerelease entries are ignored`() = runBlocking {
        val body = """[
          {"tag_name":"0.4.0","draft":true,"prerelease":false,"assets":[]},
          {"tag_name":"0.3.2","draft":false,"prerelease":true,"assets":[]},
          {"tag_name":"0.3.1","draft":false,"prerelease":false,"assets":[
            {"name":"orryx-editor-0.3.1.jar","browser_download_url":"https://github.com/a/b/jar"},
            {"name":"orryx-editor-0.3.1.jar.sha256","browser_download_url":"https://github.com/a/b/sum"},
            {"name":"update-manifest.json","browser_download_url":"https://github.com/a/b/manifest"}
          ]}
        ]"""
        val engine = MockEngine { respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }
        val client = HttpClient(engine) { followRedirects = false }
        val result = GitHubReleaseClient(client, config()).latestStable()
        assertEquals(SemVer(0, 3, 1), result.version)
        client.close()
    }

    @Test fun `token is sent only through authorization header`() = runBlocking {
        val body = """[{"tag_name":"0.3.1","assets":[
          {"name":"orryx-editor-0.3.1.jar","browser_download_url":"https://github.com/jar"},
          {"name":"orryx-editor-0.3.1.jar.sha256","browser_download_url":"https://github.com/sum"},
          {"name":"update-manifest.json","browser_download_url":"https://github.com/manifest"}
        ]}]"""
        val engine = MockEngine { request ->
            assertEquals("Bearer secret-token", request.headers[HttpHeaders.Authorization])
            assertFalse(request.url.toString().contains("secret-token"))
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val client = HttpClient(engine) { followRedirects = false }
        GitHubReleaseClient(client, config().copy(githubToken = "secret-token")).latestStable()
        client.close()
    }

    @Test fun `non allowlisted redirect host is rejected`() = runBlocking {
        val engine = MockEngine { respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://evil.example/update")) }
        val client = HttpClient(engine) { followRedirects = false }
        val failure = assertFailsWith<UpdateFailure> { GitHubReleaseClient(client, config()).latestStable() }
        assertEquals(UpdateErrorCode.REDIRECT_REJECTED, failure.code)
        client.close()
    }

    private fun config() = UpdateConfig("owner/repo", null, 1024, Path.of("build/test-updates"))
}
