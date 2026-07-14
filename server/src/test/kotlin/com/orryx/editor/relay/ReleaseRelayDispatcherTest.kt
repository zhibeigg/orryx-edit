package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageParseResult
import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolVersion
import com.orryx.editor.protocol.ReleaseRequestData
import com.orryx.editor.protocol.WsProtocol
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull

class ReleaseRelayDispatcherTest {
    @Test
    fun `dispatch targets the authoritative commercial server instance`() = runTest {
        val registry = SessionRegistry()
        val socket = RecordingSocket()
        val server = registry.registerServer(
            licenseKey = "license-12345678",
            serverKey = "server-key",
            serverName = "Test",
            serverId = "stable-server-id",
            session = socket,
            negotiatedProtocol = ProtocolVersion.V2,
            capabilities = ReleaseRelayCapabilities.requiredPlugin + "revision.sha256"
        )
        assertNotNull(registry.bindServerInstance(server.session, "11111111-1111-4111-8111-111111111111"))

        val result = ReleaseRelayDispatcher(registry, enabled = true).dispatch(
            "11111111-1111-4111-8111-111111111111",
            request()
        )

        assertIs<ReleaseDispatchResult.Dispatched>(result)
        val message = assertIs<MessageParseResult.Success>(WsProtocol.parse(socket.messages.single())).message
        assertEquals(MessageTypes.RELEASE_REQUEST, message.type)
        assertEquals(request().commandId, message.id)
    }

    @Test
    fun `dispatch refuses v1 and incomplete release capabilities`() = runTest {
        val registry = SessionRegistry()
        val v1Socket = RecordingSocket()
        val v1 = registry.registerServer(
            licenseKey = "license-12345678",
            serverKey = "server-key-v1",
            serverName = "V1",
            serverId = "stable-v1-id",
            session = v1Socket,
            negotiatedProtocol = ProtocolVersion.V1
        )
        registry.bindServerInstance(v1.session, "22222222-2222-4222-8222-222222222222")
        assertIs<ReleaseDispatchResult.UnsupportedProtocol>(
            ReleaseRelayDispatcher(registry, true).dispatch("22222222-2222-4222-8222-222222222222", request())
        )

        val v2Socket = RecordingSocket()
        val v2 = registry.registerServer(
            licenseKey = "license-abcdefgh",
            serverKey = "server-key-v2",
            serverName = "V2",
            serverId = "stable-v2-id",
            session = v2Socket,
            negotiatedProtocol = ProtocolVersion.V2,
            capabilities = setOf("revision.sha256")
        )
        registry.bindServerInstance(v2.session, "33333333-3333-4333-8333-333333333333")
        val missing = assertIs<ReleaseDispatchResult.MissingCapabilities>(
            ReleaseRelayDispatcher(registry, true).dispatch("33333333-3333-4333-8333-333333333333", request())
        )
        assertEquals(ReleaseRelayCapabilities.requiredPlugin, missing.capabilities)
    }

    private fun request() = ReleaseRequestData(
        action = "status",
        transactionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        releaseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        commandId = "c".repeat(64)
    )

    private class RecordingSocket : RelaySocket {
        val messages = mutableListOf<String>()

        override suspend fun sendText(text: String) {
            messages += text
        }
    }
}
