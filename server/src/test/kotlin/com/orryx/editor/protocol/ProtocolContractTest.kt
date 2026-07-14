package com.orryx.editor.protocol

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
                assertEquals(types, ProtocolContracts.allowedTypes(direction, version))
            }
        }
        val routedTypes = expected.values.flatten().toSet()
        val reserved = (manifest.getValue("reservedUnroutedTypes") as JsonArray)
            .mapNotNull { it.jsonPrimitive.contentOrNull }
            .toSet()
        assertTrue(reserved.intersect(routedTypes).isEmpty())
        assertEquals(setOf("v1", "v2"), manifest.stringSet("protocolVersions"))
        Json.parseToJsonElement(Files.readString(Path.of("..", "schemas", "editor-protocol-v2.schema.json")))
    }

    private fun JsonObject.stringSet(key: String): Set<String> =
        (getValue(key) as JsonArray).mapNotNull { it.jsonPrimitive.contentOrNull }.toSet()
}
