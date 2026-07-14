package com.orryx.editor.ai

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Row
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant

class PostgresAiProviderCatalogRepository(
    private val database: R2dbcDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true }
) : AiProviderCatalogRepository {
    override suspend fun list(): List<AiProviderCatalogEntry> = database.withConnection { connection ->
        queryAll(
            connection.createStatement("$SELECT_COLUMNS ORDER BY provider_id")
        ) { row, _ -> row.toCatalogEntry(json) }
    }

    override suspend fun find(providerId: String): AiProviderCatalogEntry? = database.withConnection { connection ->
        queryOne(
            connection.createStatement("$SELECT_COLUMNS WHERE provider_id = $1").bind(0, providerId)
        ) { row, _ -> row.toCatalogEntry(json) }
    }

    override suspend fun updateDynamic(
        providerId: String,
        command: UpdateAiProviderCatalogCommand
    ): AiProviderCatalogEntry? = database.inTransaction { connection ->
        val config = json.encodeToString(StoredProviderConfig.serializer(), StoredProviderConfig(command.models))
        val updated = executeFully(
            connection.createStatement(
                """
                UPDATE ai_providers
                SET enabled = $2, display_name = $3, default_model = $4,
                    config = $5::jsonb, updated_at = $6
                WHERE provider_id = $1
                """.trimIndent()
            )
                .bind(0, providerId)
                .bind(1, command.enabled)
                .bind(2, command.displayName)
                .bind(3, command.defaultModel)
                .bind(4, config)
                .bind(5, command.now)
        )
        if (updated != 1L) return@inTransaction null
        queryOne(
            connection.createStatement("$SELECT_COLUMNS WHERE provider_id = $1").bind(0, providerId)
        ) { row, _ -> row.toCatalogEntry(json) }
    }

    private companion object {
        val SELECT_COLUMNS = """
            SELECT provider_id, provider_type, display_name, base_url, default_model,
                enabled, config::text AS config, created_at, updated_at
            FROM ai_providers
        """.trimIndent()
    }
}

@Serializable
internal data class StoredProviderConfig(val models: List<AiProviderModel> = emptyList())

private fun Row.toCatalogEntry(json: Json): AiProviderCatalogEntry {
    val defaultModel = required("default_model", String::class.java)
    val stored = get("config", String::class.java)
        ?.let { runCatching { json.decodeFromString(StoredProviderConfig.serializer(), it) }.getOrNull() }
    val models = stored?.models.orEmpty().ifEmpty { listOf(AiProviderModel(defaultModel, 0, 0)) }
    return AiProviderCatalogEntry(
        providerId = required("provider_id", String::class.java),
        providerType = required("provider_type", String::class.java),
        displayName = required("display_name", String::class.java),
        baseUrl = required("base_url", String::class.java),
        defaultModel = defaultModel,
        enabled = required("enabled", java.lang.Boolean::class.java).booleanValue(),
        models = models,
        createdAt = required("created_at", Instant::class.java),
        updatedAt = required("updated_at", Instant::class.java)
    )
}

private fun <T : Any> Row.required(name: String, type: Class<T>): T =
    requireNotNull(get(name, type)) { "ai_providers.$name 不能为空" }
