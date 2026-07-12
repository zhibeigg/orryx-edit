package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.WsMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RelayIsolationTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `token can be consumed atomically only once and is bound to plugin workspace`() = runBlocking {
        val registry = SessionRegistry()
        val plugin = FakeSocket()
        val server = registry.registerServer("shared-key", "alpha", "alpha-1", plugin)
        assertEquals(RelaySecrets.workspaceId("shared-key", "alpha-1"), server.workspaceId)
        assertTrue(registry.registerToken("one-time-token", plugin, "Steve", 60_000))

        val consumed = listOf(
            async { registry.consumeToken("one-time-token") },
            async { registry.consumeToken("one-time-token") }
        ).awaitAll().filterNotNull()

        assertEquals(1, consumed.size)
        assertTrue(consumed.single().pluginSession === plugin)
        assertEquals(server.workspaceId, consumed.single().workspaceId)
        assertEquals(0, registry.tokenCount())
    }

    @Test
    fun `resume stores only token hash and rotates token through auth message`() = runBlocking {
        val registry = SessionRegistry()
        val store = RecordingSessionStore()
        val relay = RelayHandler(registry, store)
        val plugin = FakeSocket()
        val firstBrowser = FakeSocket()
        val resumedBrowser = FakeSocket()
        val collaborator = FakeSocket()
        val server = registry.registerServer("shared-key", "alpha", "alpha", plugin)
        registry.bindBrowser(collaborator, "browser-other", "Alex", server)
        registry.registerToken("one-time-token", plugin, "Steve", 60_000)

        relay.handleBrowserMessage(firstBrowser, message("auth", "auth-1", "\"token\":\"one-time-token\""))
        val auth = firstBrowser.messages.map(::decode).single { it.type == MessageTypes.AUTH_RESULT }
        val resumeToken = auth.data.jsonObject["resumeToken"]?.jsonPrimitive?.contentOrNull
        assertNotNull(resumeToken)
        assertFalse(store.savedHashes.contains(resumeToken))
        assertTrue(store.savedHashes.contains(RelaySecrets.sha256(resumeToken)))
        val collaborators = auth.data.jsonObject["collaborators"] as kotlinx.serialization.json.JsonArray
        assertEquals("browser-other", collaborators.single().jsonObject["browserId"]?.jsonPrimitive?.contentOrNull)
        relay.onBrowserDisconnect(firstBrowser)

        relay.handleBrowserMessage(resumedBrowser, message("auth", "auth-2", "\"resumeToken\":\"$resumeToken\""))
        val resumed = resumedBrowser.messages.map(::decode).single { it.type == MessageTypes.AUTH_RESULT }
        val rotated = resumed.data.jsonObject["resumeToken"]?.jsonPrimitive?.contentOrNull
        assertNotNull(rotated)
        assertNotEquals(resumeToken, rotated)
        assertEquals("Steve", resumed.data.jsonObject["playerName"]?.jsonPrimitive?.contentOrNull)

        val replayBrowser = FakeSocket()
        relay.handleBrowserMessage(replayBrowser, message("auth", "auth-3", "\"resumeToken\":\"$resumeToken\""))
        val replay = replayBrowser.messages.map(::decode).single { it.type == MessageTypes.AUTH_RESULT }
        assertFalse(replay.data.jsonObject["success"]?.jsonPrimitive?.booleanOrNull ?: true)
    }

    @Test
    fun `workspace broadcasts never cross serverId boundary`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val pluginA = FakeSocket()
        val pluginB = FakeSocket()
        val browserA = FakeSocket()
        val browserB = FakeSocket()
        val serverA = registry.registerServer("shared-key", "alpha", "alpha", pluginA)
        val serverB = registry.registerServer("shared-key", "beta", "beta", pluginB)
        registry.bindBrowser(browserA, "browser-a", "Alice", serverA)
        registry.bindBrowser(browserB, "browser-b", "Bob", serverB)

        endpoint.handleServerMessage(pluginA, message("log.entry", "", "\"line\":\"only-a\""))

        assertTrue(browserA.messages.any { it.contains("only-a") })
        assertFalse(browserB.messages.any { it.contains("only-a") })
        assertNotEquals(serverA.workspaceId, serverB.workspaceId)
    }

    @Test
    fun `presence update stays local and broadcasts complete member state`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val plugin = FakeSocket()
        val browserA = FakeSocket()
        val browserB = FakeSocket()
        val server = registry.registerServer("license-key", "shared-key", "alpha", "alpha", plugin)
        registry.bindBrowser(browserA, "browser-a", "Alice", server)
        registry.bindBrowser(browserB, "browser-b", "Bob", server)

        relay.handleBrowserMessage(
            browserA,
            message("presence.update", "presence-1", "\"currentFile\":\"configs/main.yml\"")
        )

        assertTrue(plugin.messages.isEmpty())
        assertEquals("configs/main.yml", registry.getBrowserBinding(browserA)?.currentFile)
        val update = browserB.messages.map(::decode).single { it.type == MessageTypes.PRESENCE_UPDATED }
        val alice = update.data.jsonObject["members"]
            ?.let { it as kotlinx.serialization.json.JsonArray }
            ?.map { it.jsonObject }
            ?.single { it["browserId"]?.jsonPrimitive?.contentOrNull == "browser-a" }
        assertNotNull(alice)
        assertEquals("Alice", alice["playerName"]?.jsonPrimitive?.contentOrNull)
        assertEquals(server.workspaceId, alice["workspaceId"]?.jsonPrimitive?.contentOrNull)
        assertEquals("configs/main.yml", alice["currentFile"]?.jsonPrimitive?.contentOrNull)
        assertTrue((alice["lastActiveAt"]?.jsonPrimitive?.long ?: 0L) > 0L)
    }

    @Test
    fun `relay id targets one plugin and response restores original browser id`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val pluginTarget = FakeSocket()
        val pluginOther = FakeSocket()
        val browser = FakeSocket()
        val targetServer = registry.registerServer("shared-key", "alpha", "same-workspace", pluginTarget)
        registry.registerServer("shared-key", "alpha replica", "same-workspace", pluginOther)
        registry.bindBrowser(browser, "browser-a", "Alice", targetServer)

        relay.handleBrowserMessage(browser, message("file.read", "browser-request-7", "\"path\":\"config.yml\""))

        assertEquals(1, pluginTarget.messages.size)
        assertTrue(pluginOther.messages.isEmpty())
        val forwarded = decode(pluginTarget.messages.single())
        assertNotEquals("browser-request-7", forwarded.id)
        assertTrue(forwarded.id.length >= 24)

        endpoint.handleServerMessage(
            pluginTarget,
            message("file.content", forwarded.id, "\"path\":\"config.yml\",\"content\":\"ok\"")
        )

        val response = browser.messages.map(::decode).single { it.type == "file.content" }
        assertEquals("browser-request-7", response.id)
        assertEquals(0L, response.data.jsonObject["revision"]?.jsonPrimitive?.long)
        assertEquals(0, registry.pendingRequestCount())
    }

    @Test
    fun `stale baseRevision conflicts without forwarding and force bypasses conflict`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()
        val browserA = FakeSocket()
        val browserB = FakeSocket()
        val server = registry.registerServer("shared-key", "alpha", "alpha", plugin)
        registry.bindBrowser(browserA, "browser-a", "Alice", server)
        registry.bindBrowser(browserB, "browser-b", "Bob", server)

        relay.handleBrowserMessage(
            browserA,
            message("file.write", "write-1", "\"path\":\"config.yml\",\"content\":\"one\",\"baseRevision\":0")
        )
        val firstForward = decode(plugin.messages.single())
        endpoint.handleServerMessage(
            plugin,
            message("file.written", firstForward.id, "\"success\":true,\"path\":\"config.yml\"")
        )
        assertEquals(1L, registry.currentRevision(server.workspaceId, "config.yml"))
        val changed = browserB.messages.map(::decode).single { it.type == MessageTypes.FILE_CHANGED }
        assertEquals("browser-a", changed.data.jsonObject["browserId"]?.jsonPrimitive?.contentOrNull)
        val forwardedCount = plugin.messages.size

        relay.handleBrowserMessage(
            browserB,
            message("file.write", "write-stale", "\"path\":\"config.yml\",\"content\":\"two\",\"baseRevision\":0")
        )

        assertEquals(forwardedCount, plugin.messages.size)
        val conflict = browserB.messages.map(::decode).single { it.id == "write-stale" }
        assertEquals(MessageTypes.ERROR, conflict.type)
        assertEquals("REVISION_CONFLICT", conflict.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals(1L, conflict.data.jsonObject["currentRevision"]?.jsonPrimitive?.long)

        relay.handleBrowserMessage(
            browserB,
            message("file.write", "write-force", "\"path\":\"config.yml\",\"content\":\"forced\",\"force\":true")
        )
        assertEquals(forwardedCount + 1, plugin.messages.size)
        assertNotNull(plugin.messages.lastOrNull()?.let(::decode))
        Unit
    }

    private fun decode(text: String): WsMessage = json.decodeFromString(text)

    private fun message(type: String, id: String, dataFields: String): String =
        """{"type":"$type","id":"$id","data":{$dataFields}}"""

    private class FakeSocket : RelaySocket {
        val messages = mutableListOf<String>()
        override suspend fun sendText(text: String) {
            messages += text
        }
    }

    private class RecordingSessionStore : EditorSessionStore {
        private val delegate = InMemoryEditorSessionStore()
        val savedHashes = mutableListOf<String>()

        override suspend fun save(tokenHash: String, session: EditorSessionRecord) {
            savedHashes += tokenHash
            delegate.save(tokenHash, session)
        }

        override suspend fun consume(tokenHash: String): EditorSessionRecord? = delegate.consume(tokenHash)

        override suspend fun revoke(tokenHash: String) {
            delegate.revoke(tokenHash)
        }
    }

    private class AllowAllLicenses : RelayLicenseAccess {
        override suspend fun validate(license: String, connectIp: String): RelayLicense = license()
        override suspend fun get(license: String): RelayLicense = license()
        override suspend fun addIp(license: String, ip: String): Boolean = true

        private fun license() = RelayLicense(
            license = "license-key",
            serverKey = "shared-key",
            enabled = true,
            expiresAt = 0,
            boundIps = emptyList()
        )
    }
}
