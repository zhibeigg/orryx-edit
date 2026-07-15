package com.orryx.editor.protocol

import com.orryx.editor.relay.PluginRelayErrorContract
import com.orryx.editor.relay.RelayCapabilities
import com.orryx.editor.relay.V2EditorPluginCapabilities
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ProtocolContractTest {
    @Test
    fun `hard allowlist rejects unknown and wrong direction types`() {
        val unknown = ProtocolContracts.validate(
            "file.execute",
            ProtocolRole.BROWSER,
            MessageDirection.BROWSER_TO_RELAY,
            ProtocolVersion.V1
        )
        assertEquals("UNKNOWN_MESSAGE_TYPE", assertIs<ContractValidationResult.Rejected>(unknown).error.code)

        val wrongDirection = ProtocolContracts.validate(
            MessageTypes.FILE_CONTENT,
            ProtocolRole.BROWSER,
            MessageDirection.BROWSER_TO_RELAY,
            ProtocolVersion.V2
        )
        assertEquals("MESSAGE_DIRECTION_NOT_ALLOWED", assertIs<ContractValidationResult.Rejected>(wrongDirection).error.code)
    }

    @Test
    fun `request contracts expose stable expected response types`() {
        assertEquals(MessageTypes.FILE_TREE, ProtocolContracts.expectedResponseType(MessageTypes.FILE_LIST, ProtocolVersion.V1))
        assertEquals(MessageTypes.FILE_CONTENT, ProtocolContracts.expectedResponseType(MessageTypes.FILE_READ, ProtocolVersion.V2))
        assertEquals(MessageTypes.FILE_WRITTEN, ProtocolContracts.expectedResponseType(MessageTypes.FILE_WRITE, ProtocolVersion.V2))
        assertEquals(MessageTypes.RELOAD_RESULT, ProtocolContracts.expectedResponseType(MessageTypes.RELOAD, ProtocolVersion.V1))
    }

    @Test
    fun `protocol version parser accepts only v1 and v2 wire forms`() {
        assertEquals(ProtocolVersion.V1, ProtocolVersion.parse("1"))
        assertEquals(ProtocolVersion.V1, ProtocolVersion.parse("V1"))
        assertEquals(ProtocolVersion.V2, ProtocolVersion.parse("v2"))
        assertEquals(null, ProtocolVersion.parse("v3"))
    }

    @Test
    fun `manifest snapshot round trip is v2 only`() {
        listOf(
            Triple(MessageTypes.MANIFEST_GET, ProtocolRole.BROWSER, MessageDirection.BROWSER_TO_RELAY),
            Triple(MessageTypes.MANIFEST_GET, ProtocolRole.RELAY, MessageDirection.RELAY_TO_PLUGIN),
            Triple(MessageTypes.MANIFEST_SNAPSHOT, ProtocolRole.PLUGIN, MessageDirection.PLUGIN_TO_RELAY),
            Triple(MessageTypes.MANIFEST_SNAPSHOT, ProtocolRole.RELAY, MessageDirection.RELAY_TO_BROWSER),
        ).forEach { (type, role, direction) ->
            assertIs<ContractValidationResult.Allowed>(
                ProtocolContracts.validate(type, role, direction, ProtocolVersion.V2)
            )
            val v1 = ProtocolContracts.validate(type, role, direction, ProtocolVersion.V1)
            assertEquals("MESSAGE_NOT_SUPPORTED", assertIs<ContractValidationResult.Rejected>(v1).error.code)
        }
        assertEquals(
            MessageTypes.MANIFEST_SNAPSHOT,
            ProtocolContracts.expectedResponseType(MessageTypes.MANIFEST_GET, ProtocolVersion.V2)
        )
        assertEquals(null, ProtocolContracts.expectedResponseType(MessageTypes.MANIFEST_GET, ProtocolVersion.V1))
    }

    @Test
    fun `release control is v2 plugin only and never browser routable`() {
        assertIs<ContractValidationResult.Allowed>(
            ProtocolContracts.validate(
                MessageTypes.RELEASE_REQUEST,
                ProtocolRole.RELAY,
                MessageDirection.RELAY_TO_PLUGIN,
                ProtocolVersion.V2
            )
        )
        assertIs<ContractValidationResult.Allowed>(
            ProtocolContracts.validate(
                MessageTypes.RELEASE_RESULT,
                ProtocolRole.PLUGIN,
                MessageDirection.PLUGIN_TO_RELAY,
                ProtocolVersion.V2
            )
        )
        val v1 = ProtocolContracts.validate(
            MessageTypes.RELEASE_REQUEST,
            ProtocolRole.RELAY,
            MessageDirection.RELAY_TO_PLUGIN,
            ProtocolVersion.V1
        )
        assertEquals("MESSAGE_NOT_SUPPORTED", assertIs<ContractValidationResult.Rejected>(v1).error.code)
        val browser = ProtocolContracts.validate(
            MessageTypes.RELEASE_REQUEST,
            ProtocolRole.BROWSER,
            MessageDirection.BROWSER_TO_RELAY,
            ProtocolVersion.V2
        )
        assertEquals("MESSAGE_DIRECTION_NOT_ALLOWED", assertIs<ContractValidationResult.Rejected>(browser).error.code)
    }

    @Test
    fun `canonical relay manifest matches runtime allowlists and reserved routes`() {
        val manifestPath = Path.of("..", "schemas", "editor-relay-contract-v2.json")
        val manifest = Json.parseToJsonElement(Files.readString(manifestPath)).jsonObject
        val directions = manifest.getValue("directions").jsonObject
        val expected = mapOf(
            MessageDirection.BROWSER_TO_RELAY to directions.stringSet("browserToRelay"),
            MessageDirection.RELAY_TO_PLUGIN to directions.stringSet("relayToPlugin"),
            MessageDirection.PLUGIN_TO_RELAY to directions.stringSet("pluginToRelay"),
            MessageDirection.RELAY_TO_BROWSER to directions.stringSet("relayToBrowser"),
        )

        ProtocolVersion.entries.forEach { version ->
            expected.forEach { (direction, types) ->
                val versionTypes = if (version == ProtocolVersion.V1) {
                    types - setOf(
                        MessageTypes.MANIFEST_GET,
                        MessageTypes.MANIFEST_SNAPSHOT,
                        MessageTypes.RELEASE_REQUEST,
                        MessageTypes.RELEASE_RESULT,
                    )
                } else {
                    types
                }
                assertEquals(versionTypes, ProtocolContracts.allowedTypes(direction, version))
            }
        }
        val routedTypes = expected.values.flatten().toSet()
        val reserved = (manifest.getValue("reservedUnroutedTypes") as JsonArray)
            .mapNotNull { it.jsonPrimitive.contentOrNull }
            .toSet()
        assertTrue(reserved.isEmpty())
        assertTrue(reserved.intersect(routedTypes).isEmpty())
        assertEquals(setOf("v1", "v2"), manifest.stringSet("protocolVersions"))
        val v2 = manifest.getValue("v2").jsonObject
        val manifestContract = v2.getValue("manifest").jsonObject
        assertEquals(
            ProtocolLimits.MAX_MANIFEST_FILES.toString(),
            manifestContract.getValue("maxFiles").jsonPrimitive.contentOrNull
        )
        val pluginError = v2.getValue("pluginError").jsonObject
        assertEquals(PluginRelayErrorContract.forwardedFields, pluginError.stringSet("forwardedFields"))
        assertEquals(PluginRelayErrorContract.safeCodes, pluginError.stringSet("safeCodes"))
        assertTrue(
            PluginRelayErrorContract.safeCodes.containsAll(
                setOf(
                    "FILE_POLICY_VIOLATION",
                    "PRECONDITION_FAILED",
                    "CASE_CONFLICT",
                    "MUTATION_GATE_ACTIVE",
                    "REQUEST_QUEUE_FULL",
                    "REVISION_FIELDS_MISMATCH",
                    "REVISION_REQUIRED",
                    "READINESS_FAILED",
                    "ROLLBACK_FAILED",
                    "ROLLBACK_RELOAD_FAILED",
                    "ROLLBACK_MANIFEST_MISMATCH",
                    "RECOVERY_AMBIGUOUS",
                )
            )
        )
        assertEquals(
            PluginRelayErrorContract.FALLBACK_CODE,
            pluginError.getValue("fallbackCode").jsonPrimitive.contentOrNull
        )
        val requiredV2PluginCapabilities = v2.stringSet("requiredPluginCapabilities")
        val requiredMutationCapabilities = v2.stringSet("requiredMutationCapabilities")
        assertEquals(
            setOf(RelayCapabilities.REVISION_SHA256, RelayCapabilities.FILE_WRITE_V2),
            requiredV2PluginCapabilities
        )
        assertEquals(setOf("mutation.preconditions"), requiredMutationCapabilities)
        assertEquals(
            requiredV2PluginCapabilities + requiredMutationCapabilities,
            V2EditorPluginCapabilities.required
        )
        assertEquals(
            RelayCapabilities.REVISION_SHA256,
            v2.getValue("relayRevisionCapability").jsonPrimitive.contentOrNull
        )
        assertEquals(
            RelayCapabilities.FILE_WRITE_V2,
            v2.getValue("relayWriteCapability").jsonPrimitive.contentOrNull
        )
        assertEquals(
            RelayCapabilities.RELEASE_CONTROL_V1,
            v2.getValue("relayReleaseCapability").jsonPrimitive.contentOrNull
        )
        assertEquals(
            "complete-target-snapshot",
            v2.getValue("releaseOperationsSemantics").jsonPrimitive.contentOrNull
        )
        val protocolSchema = Json.parseToJsonElement(
            Files.readString(Path.of("..", "schemas", "editor-protocol-v2.schema.json"))
        ).jsonObject
        val schemaDefinitions = protocolSchema.getValue("\$defs").jsonObject
        val releaseFileMaximum = schemaDefinitions
            .getValue("releaseRequestData").jsonObject
            .getValue("properties").jsonObject
            .getValue("fileCount").jsonObject
            .getValue("maximum").jsonPrimitive.contentOrNull
        assertEquals(ProtocolLimits.MAX_MANIFEST_FILES.toString(), releaseFileMaximum)
        val schemaPluginErrorCodes = schemaDefinitions
            .getValue("pluginErrorData").jsonObject
            .getValue("properties").jsonObject
            .getValue("code").jsonObject
            .stringSet("enum")
        assertEquals(PluginRelayErrorContract.safeCodes, schemaPluginErrorCodes)
    }

    private fun JsonObject.stringSet(key: String): Set<String> =
        (getValue(key) as JsonArray).mapNotNull { it.jsonPrimitive.contentOrNull }.toSet()
}
