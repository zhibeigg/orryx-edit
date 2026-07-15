package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolVersion
import com.orryx.editor.protocol.WsMessage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ServerEndpointReconnectTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val features = RelayFeatureFlags(protocolV2Enabled = true, v2WritesEnabled = true)

    @Test
    fun `authoritative disconnect keeps binding offline and replacement registration notifies after rebind`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(registry, AllowAllLicenses(), features)
        val relay = RelayHandler(registry, features = features)
        val oldPlugin = RecordingSocket()
        val newPlugin = RecordingSocket()
        var bindingAtOnlineNotification: BrowserBinding? = null
        lateinit var browser: RecordingSocket
        browser = RecordingSocket { text ->
            val message = decode(text)
            if (message.type == MessageTypes.SERVER_INFO && message.data.jsonObject["online"]?.jsonPrimitive?.booleanOrNull == true) {
                bindingAtOnlineNotification = registry.getBrowserBinding(browser)
            }
        }

        endpoint.handleServerMessage(oldPlugin, registerMessage("old-register", ProtocolVersion.V1))
        val oldServer = assertNotNull(registry.getServerBySession(oldPlugin))
        registry.bindBrowser(browser, "browser-a", "Alice", oldServer)
        browser.messages.clear()

        endpoint.onServerDisconnect(oldPlugin)

        val suspended = registry.getBrowserBinding(browser)
        assertTrue(suspended?.suspended == true)
        assertEquals(1, registry.browserCount())
        val offline = browser.messages.map(::decode).single { it.type == MessageTypes.SERVER_INFO }
        assertServerInfo(offline, online = false, server = oldServer)

        relay.handleBrowserMessage(browser, message(MessageTypes.FILE_LIST, "offline-list", ""))
        val offlineError = browser.messages.map(::decode).single { it.id == "offline-list" }
        assertEquals(MessageTypes.ERROR, offlineError.type)
        assertEquals("SERVER_OFFLINE", offlineError.data.jsonObject["code"]?.jsonPrimitive?.contentOrNull)

        browser.messages.clear()
        endpoint.handleServerMessage(newPlugin, registerMessage("new-register", ProtocolVersion.V2))
        val newServer = assertNotNull(registry.getServerBySession(newPlugin))
        val rebound = assertNotNull(registry.getBrowserBinding(browser))
        assertSame(newPlugin, rebound.pluginSession)
        assertEquals(ProtocolVersion.V2, rebound.protocolVersion)
        assertEquals(newServer.sessionEpoch, rebound.sessionEpoch)
        assertSame(newPlugin, bindingAtOnlineNotification?.pluginSession)
        assertEquals(newServer.sessionEpoch, bindingAtOnlineNotification?.sessionEpoch)

        val online = browser.messages.map(::decode).single { it.type == MessageTypes.SERVER_INFO }
        assertServerInfo(online, online = true, server = newServer)
        val capabilities = online.data.jsonObject.getValue("relayCapabilities").jsonArray
            .mapNotNull { it.jsonPrimitive.contentOrNull }
            .toSet()
        assertTrue(RelayCapabilities.REVISION_SHA256 in capabilities)
        assertTrue(RelayCapabilities.FILE_WRITE_V2 in capabilities)
    }

    @Test
    fun `overlapping authoritative switch notifies browser and stale disconnect stays silent`() = runBlocking {
        val registry = SessionRegistry()
        val endpoint = ServerEndpoint(registry, AllowAllLicenses(), features)
        val oldPlugin = RecordingSocket()
        val newPlugin = RecordingSocket()
        val browser = RecordingSocket()

        endpoint.handleServerMessage(oldPlugin, registerMessage("old-register", ProtocolVersion.V1))
        val oldServer = assertNotNull(registry.getServerBySession(oldPlugin))
        registry.bindBrowser(browser, "browser-a", "Alice", oldServer)
        browser.messages.clear()

        endpoint.handleServerMessage(newPlugin, registerMessage("new-register", ProtocolVersion.V2))
        val newServer = assertNotNull(registry.getServerBySession(newPlugin))
        val switchInfo = browser.messages.map(::decode).single { it.type == MessageTypes.SERVER_INFO }
        assertServerInfo(switchInfo, online = true, server = newServer)
        assertSame(newPlugin, registry.getBrowserBinding(browser)?.pluginSession)

        browser.messages.clear()
        endpoint.onServerDisconnect(oldPlugin)

        assertFalse(browser.messages.map(::decode).any {
            it.type == MessageTypes.SERVER_INFO && it.data.jsonObject["online"]?.jsonPrimitive?.booleanOrNull == false
        })
        assertSame(newPlugin, registry.getBrowserBinding(browser)?.pluginSession)
    }

    private fun assertServerInfo(message: WsMessage, online: Boolean, server: GameServer) {
        val data = message.data.jsonObject
        assertEquals(online, data["online"]?.jsonPrimitive?.booleanOrNull)
        assertEquals(server.workspaceId, data["workspaceId"]?.jsonPrimitive?.contentOrNull)
        assertEquals(server.serverId, data["serverId"]?.jsonPrimitive?.contentOrNull)
        assertEquals(server.negotiatedProtocol.wireName, data["negotiatedProtocol"]?.jsonPrimitive?.contentOrNull)
        assertEquals(server.sessionEpoch, data["sessionEpoch"]?.jsonPrimitive?.longOrNull)
        assertNotNull(data["relayCapabilities"])
    }

    private fun registerMessage(id: String, protocol: ProtocolVersion): String {
        val capabilities = if (protocol == ProtocolVersion.V2) {
            ",\"capabilities\":[\"revision.sha256\",\"file.write.v2\",\"mutation.preconditions\"]"
        } else {
            ""
        }
        return """{"type":"server.register","id":"$id","data":{"license":"license-key","serverName":"stable","serverId":"stable-server","protocolVersions":["${protocol.wireName}"],"preferredProtocol":"${protocol.wireName}"$capabilities}}"""
    }

    private fun message(type: String, id: String, dataFields: String): String =
        """{"type":"$type","id":"$id","data":{$dataFields}}"""

    private fun decode(text: String): WsMessage = json.decodeFromString(text)

    private class RecordingSocket(private val onSend: ((String) -> Unit)? = null) : RelaySocket {
        val messages = mutableListOf<String>()

        override suspend fun sendText(text: String) {
            messages += text
            onSend?.invoke(text)
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
            boundIps = emptyList(),
        )
    }
}
