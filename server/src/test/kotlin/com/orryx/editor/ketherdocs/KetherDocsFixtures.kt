package com.orryx.editor.ketherdocs

import com.orryx.editor.database.sha256
import java.time.Instant

internal const val TEST_PLUGIN_VERSION = "2.43.114"
internal const val TEST_COMMIT = "bf8bc95a1234567890abcdef1234567890abcdef"
internal const val TEST_RELEASE_ID = "Orryx@$TEST_PLUGIN_VERSION+$TEST_COMMIT"

internal fun validSchemaBytes(): ByteArray = """
    {
      "${'$'}schema": "https://zhibeigg.github.io/Orryx/kether/contracts/actions-schema-v3.schema.json",
      "version": 2,
      "schemaVersion": 3,
      "pluginId": "Orryx",
      "pluginVersion": "$TEST_PLUGIN_VERSION",
      "commit": "$TEST_COMMIT",
      "types": { "text": { "widget": "text", "color": "#aaa" } },
      "categories": { "test": { "color": "#aaa", "icon": "test" } },
      "actions": [
        {
          "id": "orryx.action.test.0123456789ab",
          "name": "test",
          "namespace": "orryx",
          "category": "test",
          "description": "test",
          "syntax": "test",
          "inputs": [],
          "output": null,
          "flow": "normal"
        }
      ],
      "selectors": [
        {
          "id": "orryx.selector.self.0123456789ab",
          "name": "self",
          "description": "self",
          "syntax": "@self",
          "params": []
        }
      ],
      "triggers": [
        {
          "id": "orryx.trigger.test.0123456789ab",
          "name": "test",
          "category": "test",
          "variables": []
        }
      ],
      "properties": [
        {
          "id": "orryx.property.test",
          "name": "test",
          "category": "test",
          "keys": []
        }
      ]
    }
""".trimIndent().plus("\n").toByteArray()

internal fun validSchemaV4Bytes(): ByteArray = validSchemaBytes().toString(Charsets.UTF_8)
    .replace("actions-schema-v3.schema.json", "actions-schema-v4.schema.json")
    .replace("\"schemaVersion\": 3", "\"schemaVersion\": 4")
    .replace(
        "\"text\": { \"widget\": \"text\", \"color\": \"#aaa\" }",
        "\"text\": { \"widget\": \"text\", \"color\": \"#aaa\", \"extends\": [], \"ketherFillable\": true, \"inputStrategy\": \"expression\", \"serialization\": \"quoted\" }"
    )
    .replace(
        "\"id\": \"orryx.action.test.0123456789ab\",",
        "\"id\": \"orryx.action.test.0123456789ab\",\n          \"variantId\": \"orryx.action.test.0123456789ab.default\",\n          \"shape\": \"command\","
    )
    .toByteArray()

internal fun validFetchedSchema(): FetchedKetherDocs {
    val bytes = validSchemaBytes()
    return FetchedKetherDocs(
        releaseId = TEST_RELEASE_ID,
        pluginVersion = TEST_PLUGIN_VERSION,
        commit = TEST_COMMIT,
        schemaVersion = 3,
        publishedAt = Instant.parse("2026-03-20T00:00:00Z"),
        schemaSha256 = sha256(bytes),
        schemaBytes = bytes
    )
}

internal class InMemoryKetherDocsRepository : KetherDocsRepository {
    var cache: CachedKetherDocs? = null
    var state: StoredKetherDocsSyncState? = null

    override suspend fun load(channel: String): CachedKetherDocs? = cache?.takeIf { it.channel == channel }

    override suspend fun saveSuccess(cache: CachedKetherDocs, state: StoredKetherDocsSyncState) {
        this.cache = cache
        this.state = state
    }

    override suspend fun loadState(channel: String): StoredKetherDocsSyncState? = state?.takeIf { it.channel == channel }

    override suspend fun saveState(state: StoredKetherDocsSyncState) {
        this.state = state
    }
}

internal class StubKetherDocsUpstream(var result: Result<FetchedKetherDocs>) : KetherDocsUpstream {
    override suspend fun fetchLatest(): FetchedKetherDocs = result.getOrThrow()
}
