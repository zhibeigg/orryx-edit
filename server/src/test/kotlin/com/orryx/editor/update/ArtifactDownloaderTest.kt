package com.orryx.editor.update

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ArtifactDownloaderTest {
    @Test fun `streaming download enforces maximum bytes`() = runBlocking {
        val engine = MockEngine { respond(ByteArray(17) { 1 }, HttpStatusCode.OK) }
        val client = HttpClient(engine) { followRedirects = false }
        val directory = createTempDirectory("orryx-update-test")
        val failure = assertFailsWith<UpdateFailure> {
            ArtifactDownloader(client, UpdateConfig("owner/repo", null, 16, directory))
                .download("https://github.com/asset", directory.resolve("asset.jar"))
        }
        assertEquals(UpdateErrorCode.DOWNLOAD_TOO_LARGE, failure.code)
        client.close()
    }

    @Test fun `streaming download returns sha256 while writing`() = runBlocking {
        val bytes = "verified artifact".encodeToByteArray()
        val engine = MockEngine { respond(bytes, HttpStatusCode.OK, headersOf(HttpHeaders.ContentLength, bytes.size.toString())) }
        val client = HttpClient(engine) { followRedirects = false }
        val directory = createTempDirectory("orryx-update-test")
        val target = directory.resolve("asset.jar")
        val actual = ArtifactDownloader(client, UpdateConfig("owner/repo", null, 1024, directory))
            .download("https://github.com/asset", target)
        val expected = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        assertEquals(expected, actual)
        assertEquals(bytes.toList(), Files.readAllBytes(target).toList())
        client.close()
    }
}
