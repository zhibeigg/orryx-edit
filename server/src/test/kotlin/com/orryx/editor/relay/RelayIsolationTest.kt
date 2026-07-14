package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolVersion
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
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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
        registry.registerServer("shared-key", "alpha replica", "same-workspace", pluginOther)
        val targetServer = registry.registerServer("shared-key", "alpha", "same-workspace", pluginTarget)
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

    @Test
    fun `unknown and wrong direction browser messages are rejected without forwarding`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer("shared-key", "alpha", "alpha", plugin)
        registry.bindBrowser(browser, "browser-a", "Alice", server)

        relay.handleBrowserMessage(browser, message("file.execute", "unknown-1", ""))
        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_CONTENT, "wrong-1", "\"path\":\"config.yml\""))

        assertTrue(plugin.messages.isEmpty())
        val errors = browser.messages.map(::decode).associateBy(WsMessage::id)
        assertEquals("UNKNOWN_MESSAGE_TYPE", errors.getValue("unknown-1").data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals("MESSAGE_DIRECTION_NOT_ALLOWED", errors.getValue("wrong-1").data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `unknown and wrong direction plugin messages are rejected before routing`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()
        registry.registerServer("shared-key", "alpha", "alpha", plugin)

        endpoint.handleServerMessage(plugin, message("plugin.execute", "unknown-plugin", ""))
        endpoint.handleServerMessage(plugin, message(MessageTypes.FILE_READ, "wrong-plugin", "\"path\":\"config.yml\""))

        val errors = plugin.messages.map(::decode).associateBy(WsMessage::id)
        assertEquals("UNKNOWN_MESSAGE_TYPE", errors.getValue("unknown-plugin").data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals("MESSAGE_DIRECTION_NOT_ALLOWED", errors.getValue("wrong-plugin").data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals(0, registry.pendingRequestCount())
    }

    @Test
    fun `unexpected plugin response type returns a stable browser error`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer("shared-key", "alpha", "alpha", plugin)
        registry.bindBrowser(browser, "browser-a", "Alice", server)

        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_READ, "read-1", "\"path\":\"config.yml\""))
        val forwarded = decode(plugin.messages.single())
        endpoint.handleServerMessage(plugin, message(MessageTypes.FILE_TREE, forwarded.id, "\"files\":[]"))

        val browserRejection = browser.messages.map(::decode).single { it.id == "read-1" }
        assertEquals(MessageTypes.ERROR, browserRejection.type)
        assertEquals("UNEXPECTED_RESPONSE_TYPE", browserRejection.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        val pluginRejection = decode(plugin.messages.last())
        assertEquals(MessageTypes.ERROR, pluginRejection.type)
        assertEquals("UNEXPECTED_RESPONSE_TYPE", pluginRejection.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals(0, registry.pendingRequestCount())
    }

    @Test
    fun `server registration keeps v2 disabled until relay rollout flag is enabled`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()

        endpoint.handleServerMessage(
            plugin,
            message(
                MessageTypes.SERVER_REGISTER,
                "modern-reg",
                "\"license\":\"license-key\",\"serverName\":\"modern\",\"serverId\":\"modern-1\"," +
                    "\"protocolVersions\":[\"v1\",\"v2\"],\"preferredProtocol\":\"v2\""
            )
        )

        val result = decode(plugin.messages.single()).data.jsonObject
        assertEquals("v1", result["negotiatedProtocol"]?.jsonPrimitive?.contentOrNull)
        val relayCapabilities = result["relayCapabilities"] as kotlinx.serialization.json.JsonArray
        assertFalse(relayCapabilities.any { it.jsonPrimitive.contentOrNull == "revision.sha256" })
    }

    @Test
    fun `server registration negotiates enabled v2 and keeps legacy plugins on v1`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(
            registry,
            AllowAllLicenses(),
            RelayFeatureFlags(protocolV2Enabled = true),
        )
        val legacy = FakeSocket()
        val modern = FakeSocket()

        endpoint.handleServerMessage(
            legacy,
            message(MessageTypes.SERVER_REGISTER, "legacy-reg", "\"license\":\"license-key\",\"serverName\":\"legacy\"")
        )
        val legacyResult = decode(legacy.messages.single()).data.jsonObject
        assertEquals("v1", legacyResult["negotiatedProtocol"]?.jsonPrimitive?.contentOrNull)
        assertEquals("legacy", legacyResult["serverId"]?.jsonPrimitive?.contentOrNull)
        assertNotNull(legacyResult["sessionEpoch"]?.jsonPrimitive?.longOrNull)

        endpoint.handleServerMessage(
            modern,
            message(
                MessageTypes.SERVER_REGISTER,
                "modern-reg",
                "\"license\":\"license-key\",\"serverName\":\"modern\",\"serverId\":\"modern-1\"," +
                    "\"pluginVersion\":\"1.2.3\",\"protocolVersions\":[\"v1\",\"v2\"]," +
                    "\"preferredProtocol\":\"v2\",\"capabilities\":[\"revision.sha256\"]," +
                    "\"connectionNonce\":\"nonce-12345678\""
            )
        )
        val modernResult = decode(modern.messages.single()).data.jsonObject
        assertEquals("v2", modernResult["negotiatedProtocol"]?.jsonPrimitive?.contentOrNull)
        assertEquals("nonce-12345678", modernResult["connectionNonce"]?.jsonPrimitive?.contentOrNull)
        val relayCapabilities = modernResult["relayCapabilities"] as kotlinx.serialization.json.JsonArray
        assertTrue(relayCapabilities.any { it.jsonPrimitive.contentOrNull == "revision.sha256" })
        assertFalse(relayCapabilities.any { it.jsonPrimitive.contentOrNull == "file.write.v2" })
    }

    @Test
    fun `new workspace registration becomes authoritative and stale plugin messages are rejected`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val oldPlugin = FakeSocket()
        val newPlugin = FakeSocket()
        val browser = FakeSocket()
        val oldServer = registry.registerServer(
            "license-key", "shared-key", "alpha-old", "alpha", oldPlugin,
            negotiatedProtocol = ProtocolVersion.V2
        )
        registry.bindBrowser(browser, "browser-a", "Alice", oldServer)
        val newServer = registry.registerServer(
            "license-key", "shared-key", "alpha-new", "alpha", newPlugin,
            negotiatedProtocol = ProtocolVersion.V2
        )
        assertTrue(newServer.sessionEpoch > oldServer.sessionEpoch)

        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_READ, "read-new", "\"path\":\"config.yml\""))
        assertTrue(oldPlugin.messages.isEmpty())
        assertEquals(1, newPlugin.messages.size)

        endpoint.handleServerMessage(oldPlugin, message(MessageTypes.LOG_ENTRY, "", "\"line\":\"stale\""))
        val stale = decode(oldPlugin.messages.single())
        assertEquals("STALE_PLUGIN_SESSION", stale.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertFalse(browser.messages.any { it.contains("stale") })

        oldPlugin.messages.clear()
        endpoint.handleServerMessage(
            oldPlugin,
            message(
                MessageTypes.SERVER_REGISTER,
                "stale-reregister",
                "\"license\":\"license-key\",\"serverName\":\"alpha-old\",\"serverId\":\"alpha\"," +
                    "\"protocolVersions\":[\"v1\",\"v2\"]"
            )
        )
        val staleReregister = decode(oldPlugin.messages.single())
        assertEquals("STALE_PLUGIN_SESSION", staleReregister.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertTrue(registry.getAuthoritativeServer(newServer.workspaceId)?.session === newPlugin)
    }

    @Test
    fun `all v2 mutation paths are disabled by default`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer(
            "license-key", "shared-key", "alpha", "alpha", plugin,
            negotiatedProtocol = ProtocolVersion.V2
        )
        registry.bindBrowser(browser, "browser-a", "Alice", server)
        val revision = "a".repeat(64)
        val mutations = listOf(
            Triple(MessageTypes.FILE_WRITE, "write-disabled", "\"path\":\"config.yml\",\"content\":\"x\",\"baseRevision\":\"$revision\""),
            Triple(MessageTypes.FILE_CREATE, "create-disabled", "\"path\":\"new.yml\",\"content\":\"x\""),
            Triple(MessageTypes.FILE_DELETE, "delete-disabled", "\"path\":\"old.yml\""),
            Triple(MessageTypes.FILE_RENAME, "rename-disabled", "\"oldPath\":\"old.yml\",\"newPath\":\"new.yml\""),
            Triple(MessageTypes.RELOAD, "reload-disabled", ""),
        )

        mutations.forEach { (type, id, data) ->
            relay.handleBrowserMessage(browser, message(type, id, data))
        }

        assertTrue(plugin.messages.isEmpty())
        val errors = browser.messages.map(::decode).associateBy(WsMessage::id)
        mutations.forEach { (_, id, _) ->
            assertEquals("FEATURE_DISABLED", errors.getValue(id).data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        }
    }

    @Test
    fun `v2 read preserves lowercase sha revision without touching v1 counter`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer(
            "license-key", "shared-key", "alpha", "alpha", plugin,
            negotiatedProtocol = ProtocolVersion.V2
        )
        registry.bindBrowser(browser, "browser-a", "Alice", server)
        val revision = "b".repeat(64)

        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_READ, "read-v2", "\"path\":\"config.yml\""))
        val forwarded = decode(plugin.messages.single())
        endpoint.handleServerMessage(
            plugin,
            message(MessageTypes.FILE_CONTENT, forwarded.id, "\"path\":\"config.yml\",\"content\":\"ok\",\"revision\":\"$revision\"")
        )

        val response = browser.messages.map(::decode).single { it.id == "read-v2" }
        assertEquals(revision, response.data.jsonObject["revision"]?.jsonPrimitive?.contentOrNull)
        assertEquals(0L, registry.currentRevision(server.workspaceId, "config.yml"))
    }

    @Test
    fun `invalid v2 revision returns a correlated browser error`() = runBlocking {
        val registry = SessionRegistry()
        val relay = RelayHandler(registry)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses())
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer(
            "license-key", "shared-key", "alpha", "alpha", plugin,
            negotiatedProtocol = ProtocolVersion.V2,
        )
        registry.bindBrowser(browser, "browser-a", "Alice", server)

        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_READ, "read-invalid", "\"path\":\"config.yml\""))
        val forwarded = decode(plugin.messages.single())
        endpoint.handleServerMessage(
            plugin,
            message(MessageTypes.FILE_CONTENT, forwarded.id, "\"path\":\"config.yml\",\"content\":\"ok\",\"revision\":\"NOT-A-SHA\"")
        )

        val error = browser.messages.map(::decode).single { it.id == "read-invalid" }
        assertEquals(MessageTypes.ERROR, error.type)
        assertEquals("INVALID_REVISION", error.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)
        assertEquals(0, registry.pendingRequestCount())
    }

    @Test
    fun `v2 write maps baseRevision to expectedRevision and preserves plugin sha`() = runBlocking {
        val registry = SessionRegistry()
        val features = RelayFeatureFlags(protocolV2Enabled = true, v2WritesEnabled = true)
        val relay = RelayHandler(registry, features = features)
        val endpoint = ServerEndpoint(registry, AllowAllLicenses(), features)
        val plugin = FakeSocket()
        val browser = FakeSocket()
        val server = registry.registerServer(
            "license-key", "shared-key", "alpha", "alpha", plugin,
            negotiatedProtocol = ProtocolVersion.V2
        )
        registry.bindBrowser(browser, "browser-a", "Alice", server)
        val baseRevision = "c".repeat(64)
        val writtenRevision = "d".repeat(64)

        relay.handleBrowserMessage(
            browser,
            message(
                MessageTypes.FILE_WRITE,
                "write-v2",
                "\"path\":\"config.yml\",\"content\":\"next\",\"baseRevision\":\"$baseRevision\""
            )
        )
        val forwarded = decode(plugin.messages.single())
        assertEquals(baseRevision, forwarded.data.jsonObject["expectedRevision"]?.jsonPrimitive?.contentOrNull)
        assertNull(forwarded.data.jsonObject["baseRevision"])

        endpoint.handleServerMessage(
            plugin,
            message(
                MessageTypes.FILE_WRITTEN,
                forwarded.id,
                "\"success\":true,\"path\":\"config.yml\",\"revision\":\"$writtenRevision\""
            )
        )

        val response = browser.messages.map(::decode).single { it.id == "write-v2" }
        assertEquals(writtenRevision, response.data.jsonObject["revision"]?.jsonPrimitive?.contentOrNull)
        val changed = browser.messages.map(::decode).single { it.type == MessageTypes.FILE_CHANGED }
        assertEquals(writtenRevision, changed.data.jsonObject["revision"]?.jsonPrimitive?.contentOrNull)
        assertEquals(0L, registry.currentRevision(server.workspaceId, "config.yml"))

        plugin.messages.clear()
        browser.messages.clear()
        val forcedRevision = "e".repeat(64)
        relay.handleBrowserMessage(
            browser,
            message(
                MessageTypes.FILE_WRITE,
                "write-v2-force",
                "\"path\":\"config.yml\",\"content\":\"forced\",\"baseRevision\":\"$baseRevision\",\"force\":true"
            )
        )
        val forced = decode(plugin.messages.single())
        assertNull(forced.data.jsonObject["baseRevision"])
        assertNull(forced.data.jsonObject["expectedRevision"])
        endpoint.handleServerMessage(
            plugin,
            message(
                MessageTypes.FILE_WRITTEN,
                forced.id,
                "\"success\":true,\"path\":\"config.yml\",\"revision\":\"$forcedRevision\""
            )
        )
        val forcedResponse = browser.messages.map(::decode).single { it.id == "write-v2-force" }
        assertEquals(forcedRevision, forcedResponse.data.jsonObject["revision"]?.jsonPrimitive?.contentOrNull)
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
        override suspend fun validateEditorAccess(license: String, connectIp: String): RelayLicense = license()
        override suspend fun get(license: String): RelayLicense = license()
        override suspend fun addIp(license: String, ip: String): Boolean = true

        private fun license() = RelayLicense(
            license = "license-key",
            serverKey = "shared-key",
            enabled = true,
            boundIps = emptyList()
        )
    }
}
