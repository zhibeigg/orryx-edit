package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolVersion
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class SessionRegistryTest {
    @Test
    fun `authoritative disconnect suspends browser binding and rebinds it to replacement session`() = runBlocking {
        val registry = SessionRegistry()
        val oldPlugin = RecordingSocket()
        val newPlugin = RecordingSocket()
        val browser = RecordingSocket()
        val oldServer = registry.registerServer(
            licenseKey = "license-key",
            serverKey = "shared-key",
            serverName = "old",
            serverId = "stable-server",
            session = oldPlugin,
            negotiatedProtocol = ProtocolVersion.V1,
        )
        registry.bindBrowser(browser, "browser-a", "Alice", oldServer)

        registry.unregisterServer(oldPlugin)

        val suspended = registry.getBrowserBinding(browser)
        assertTrue(suspended?.suspended == true)
        assertEquals(1, registry.browserCount())
        assertEquals(setOf(browser), registry.getBrowsersForWorkspace(oldServer.workspaceId))
        assertIs<RequestReservation.ServerOffline>(
            registry.reserveRequest(
                browserSession = browser,
                originalId = "offline-read",
                type = MessageTypes.FILE_READ,
                expectedResponseType = MessageTypes.FILE_CONTENT,
                path = "config.yml",
                v1BaseRevision = null,
                force = false,
            )
        )

        val replacement = registry.registerServer(
            licenseKey = "license-key",
            serverKey = "shared-key",
            serverName = "new",
            serverId = "stable-server",
            session = newPlugin,
            negotiatedProtocol = ProtocolVersion.V2,
            capabilities = V2EditorPluginCapabilities.required,
        )

        val rebound = registry.getBrowserBinding(browser)
        assertFalse(rebound?.suspended ?: true)
        assertSame(newPlugin, rebound?.pluginSession)
        assertEquals(ProtocolVersion.V2, rebound?.protocolVersion)
        assertEquals(replacement.sessionEpoch, rebound?.sessionEpoch)
        assertNotEquals(oldServer.sessionEpoch, rebound?.sessionEpoch)

        registry.unbindBrowser(browser)
        assertEquals(0, registry.browserCount())
    }

    private class RecordingSocket : RelaySocket {
        override suspend fun sendText(text: String) = Unit
    }
}
