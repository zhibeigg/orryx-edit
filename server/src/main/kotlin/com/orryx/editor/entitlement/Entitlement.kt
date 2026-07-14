package com.orryx.editor.entitlement

import com.orryx.editor.auth.InstantIsoSerializer
import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Row
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Serializable
enum class EntitlementType {
    AI_EDITOR_PERMANENT
}

@Serializable
enum class EntitlementSourceType {
    PAYMENT,
    ADMIN,
    LEGACY
}

@Serializable
data class Entitlement(
    val id: String,
    val accountId: String,
    val type: EntitlementType,
    val sourceType: EntitlementSourceType,
    val sourceId: String,
    @Serializable(with = InstantIsoSerializer::class)
    val grantedAt: Instant
)

@Serializable
enum class GrantEntitlementOutcome {
    GRANTED,
    ALREADY_GRANTED,
    SOURCE_CONFLICT
}

@Serializable
data class GrantEntitlementResult(
    val outcome: GrantEntitlementOutcome,
    val entitlement: Entitlement? = null
)

interface EntitlementStore {
    suspend fun grantIfAbsent(entitlement: Entitlement): GrantEntitlementResult
    suspend fun find(accountId: String, type: EntitlementType): Entitlement?
    suspend fun list(accountId: String): List<Entitlement>
}

class EntitlementService(
    private val store: EntitlementStore,
    private val clock: Clock = Clock.systemUTC(),
    private val idGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    suspend fun grant(
        accountId: String,
        type: EntitlementType,
        sourceType: EntitlementSourceType,
        sourceId: String
    ): GrantEntitlementResult {
        val normalizedSourceId = sourceId.trim()
        require(normalizedSourceId.length in 1..128) { "sourceId length must be between 1 and 128" }
        val entitlement = Entitlement(
            id = UUID.fromString(idGenerator()).toString(),
            accountId = UUID.fromString(accountId).toString(),
            type = type,
            sourceType = sourceType,
            sourceId = normalizedSourceId,
            grantedAt = clock.instant()
        )
        return store.grantIfAbsent(entitlement)
    }

    suspend fun has(accountId: String, type: EntitlementType): Boolean =
        store.find(UUID.fromString(accountId).toString(), type) != null

    suspend fun list(accountId: String): List<Entitlement> = store.list(UUID.fromString(accountId).toString())
}

class InMemoryEntitlementStore : EntitlementStore {
    private val mutex = Mutex()
    private val byAccountAndType = mutableMapOf<Pair<String, EntitlementType>, Entitlement>()
    private val bySource = mutableMapOf<Pair<EntitlementSourceType, String>, Entitlement>()

    override suspend fun grantIfAbsent(entitlement: Entitlement): GrantEntitlementResult = mutex.withLock {
        val sourceKey = entitlement.sourceType to entitlement.sourceId
        val source = bySource[sourceKey]
        if (source != null && (source.accountId != entitlement.accountId || source.type != entitlement.type)) {
            return@withLock GrantEntitlementResult(GrantEntitlementOutcome.SOURCE_CONFLICT, source)
        }
        val accountKey = entitlement.accountId to entitlement.type
        val existing = byAccountAndType[accountKey]
        if (existing != null) {
            return@withLock GrantEntitlementResult(GrantEntitlementOutcome.ALREADY_GRANTED, existing)
        }
        byAccountAndType[accountKey] = entitlement
        bySource[sourceKey] = entitlement
        GrantEntitlementResult(GrantEntitlementOutcome.GRANTED, entitlement)
    }

    override suspend fun find(accountId: String, type: EntitlementType): Entitlement? = mutex.withLock {
        byAccountAndType[accountId to type]
    }

    override suspend fun list(accountId: String): List<Entitlement> = mutex.withLock {
        byAccountAndType.values.filter { it.accountId == accountId }.sortedBy { it.grantedAt }
    }
}

class PostgresEntitlementStore(private val database: R2dbcDatabase) : EntitlementStore {
    override suspend fun grantIfAbsent(entitlement: Entitlement): GrantEntitlementResult =
        database.inTransaction { connection ->
            queryOne(
                connection.createStatement("SELECT account_id FROM commercial_accounts WHERE account_id = $1 FOR UPDATE")
                    .bind(0, UUID.fromString(entitlement.accountId))
            ) { _, _ -> true } ?: error("account not found")
            val source = queryOne(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_entitlements
                    WHERE source_type = $1 AND source_id = $2
                    """.trimIndent()
                ).bind(0, entitlement.sourceType.name).bind(1, entitlement.sourceId)
            ) { row, _ -> row.toEntitlement() }
            if (source != null && (source.accountId != entitlement.accountId || source.type != entitlement.type)) {
                return@inTransaction GrantEntitlementResult(GrantEntitlementOutcome.SOURCE_CONFLICT, source)
            }
            val existing = find(connection, entitlement.accountId, entitlement.type)
            if (existing != null) {
                return@inTransaction GrantEntitlementResult(GrantEntitlementOutcome.ALREADY_GRANTED, existing)
            }
            val inserted = executeFully(
                connection.createStatement(
                    """
                    INSERT INTO commercial_entitlements(
                        entitlement_id, account_id, entitlement_type, source_type, source_id, granted_at
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT DO NOTHING
                    """.trimIndent()
                )
                    .bind(0, UUID.fromString(entitlement.id))
                    .bind(1, UUID.fromString(entitlement.accountId))
                    .bind(2, entitlement.type.name)
                    .bind(3, entitlement.sourceType.name)
                    .bind(4, entitlement.sourceId)
                    .bind(5, entitlement.grantedAt)
            )
            if (inserted == 1L) {
                GrantEntitlementResult(GrantEntitlementOutcome.GRANTED, entitlement)
            } else {
                val resolved = find(connection, entitlement.accountId, entitlement.type)
                    ?: queryOne(
                        connection.createStatement(
                            "SELECT * FROM commercial_entitlements WHERE source_type = $1 AND source_id = $2"
                        ).bind(0, entitlement.sourceType.name).bind(1, entitlement.sourceId)
                    ) { row, _ -> row.toEntitlement() }
                if (resolved?.accountId == entitlement.accountId && resolved.type == entitlement.type) {
                    GrantEntitlementResult(GrantEntitlementOutcome.ALREADY_GRANTED, resolved)
                } else {
                    GrantEntitlementResult(GrantEntitlementOutcome.SOURCE_CONFLICT, resolved)
                }
            }
        }

    override suspend fun find(accountId: String, type: EntitlementType): Entitlement? =
        database.withConnection { connection -> find(connection, accountId, type) }

    override suspend fun list(accountId: String): List<Entitlement> = database.withConnection { connection ->
        queryAll(
            connection.createStatement(
                "SELECT * FROM commercial_entitlements WHERE account_id = $1 ORDER BY granted_at, entitlement_id"
            ).bind(0, UUID.fromString(accountId))
        ) { row, _ -> row.toEntitlement() }
    }

    private suspend fun find(
        connection: io.r2dbc.spi.Connection,
        accountId: String,
        type: EntitlementType
    ): Entitlement? = queryOne(
        connection.createStatement(
            "SELECT * FROM commercial_entitlements WHERE account_id = $1 AND entitlement_type = $2"
        ).bind(0, UUID.fromString(accountId)).bind(1, type.name)
    ) { row, _ -> row.toEntitlement() }
}

private fun Row.toEntitlement(): Entitlement = Entitlement(
    id = get("entitlement_id", UUID::class.java)!!.toString(),
    accountId = get("account_id", UUID::class.java)!!.toString(),
    type = EntitlementType.valueOf(get("entitlement_type", String::class.java)!!),
    sourceType = EntitlementSourceType.valueOf(get("source_type", String::class.java)!!),
    sourceId = get("source_id", String::class.java)!!,
    grantedAt = get("granted_at", Instant::class.java)!!
)
