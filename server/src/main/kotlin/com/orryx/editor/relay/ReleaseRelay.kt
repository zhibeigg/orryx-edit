package com.orryx.editor.relay

import com.orryx.editor.protocol.MessageDirection
import com.orryx.editor.protocol.MessageTypes
import com.orryx.editor.protocol.ProtocolContracts
import com.orryx.editor.protocol.ProtocolRole
import com.orryx.editor.protocol.ProtocolVersion
import com.orryx.editor.protocol.ReleaseRequestData
import com.orryx.editor.protocol.WsMessage
import com.orryx.editor.protocol.WsProtocol
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

sealed interface ReleaseDispatchResult {
    data class Dispatched(val server: GameServer) : ReleaseDispatchResult
    data object Disabled : ReleaseDispatchResult
    data object Offline : ReleaseDispatchResult
    data object UnsupportedProtocol : ReleaseDispatchResult
    data class MissingCapabilities(val capabilities: Set<String>) : ReleaseDispatchResult
}

class ReleaseRelayDispatcher(
    private val registry: SessionRegistry,
    private val enabled: Boolean
) {
    private val json = Json { encodeDefaults = false }

    suspend fun dispatch(serverInstanceId: String, request: ReleaseRequestData): ReleaseDispatchResult {
        if (!enabled) return ReleaseDispatchResult.Disabled
        val server = registry.getAuthoritativeServerByInstance(serverInstanceId)
            ?: return ReleaseDispatchResult.Offline
        if (server.negotiatedProtocol != ProtocolVersion.V2) {
            return ReleaseDispatchResult.UnsupportedProtocol
        }
        val missingCapabilities = ReleaseRelayCapabilities.requiredPlugin - server.capabilities
        if (missingCapabilities.isNotEmpty()) {
            return ReleaseDispatchResult.MissingCapabilities(missingCapabilities)
        }
        val validation = ProtocolContracts.validate(
            type = MessageTypes.RELEASE_REQUEST,
            role = ProtocolRole.RELAY,
            direction = MessageDirection.RELAY_TO_PLUGIN,
            version = server.negotiatedProtocol
        )
        check(validation is com.orryx.editor.protocol.ContractValidationResult.Allowed) {
            "release.request is not enabled by the protocol contract"
        }
        val message = WsMessage(
            type = MessageTypes.RELEASE_REQUEST,
            id = request.commandId,
            data = json.encodeToJsonElement(request).jsonObject
        )
        server.session.sendText(WsProtocol.encode(message))
        return ReleaseDispatchResult.Dispatched(server)
    }
}
