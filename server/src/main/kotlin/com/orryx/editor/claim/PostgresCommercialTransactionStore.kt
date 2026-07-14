package com.orryx.editor.claim

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import com.orryx.editor.rbac.CommercialRole
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresCommercialTransactionStore(
    private val database: R2dbcDatabase
) : CommercialTransactionStore {
    override suspend fun claimLicense(
        accountId: String,
        licenseKey: String,
        workspaceId: String,
        now: Instant
    ): ClaimLicenseResult = database.inTransaction { connection ->
        val licenseAvailable = queryOne(
            connection.createStatement(
                """
                SELECT 1 FROM licenses
                WHERE license_key = $1 AND enabled = TRUE AND (expires_at IS NULL OR expires_at > $2)
                FOR UPDATE
                """.trimIndent()
            ).bind(0, licenseKey).bind(1, now)
        ) { _, _ -> true } ?: false
        if (!licenseAvailable) {
            return@inTransaction ClaimLicenseResult(ClaimLicenseOutcome.LICENSE_NOT_FOUND_OR_INACTIVE)
        }
        val existing = findActiveClaim(connection, licenseKey, forUpdate = true)
        if (existing != null) {
            return@inTransaction if (existing.accountId == accountId) {
                ClaimLicenseResult(
                    ClaimLicenseOutcome.ALREADY_OWNED,
                    existing,
                    findMembership(connection, existing.workspaceId, accountId)
                )
            } else {
                ClaimLicenseResult(ClaimLicenseOutcome.OWNED_BY_ANOTHER_ACCOUNT, existing)
            }
        }
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_license_claims(
                    license_key, account_id, workspace_id, status, claimed_at, released_at
                ) VALUES ($1, $2, $3, 'ACTIVE', $4, NULL)
                ON CONFLICT (license_key) DO UPDATE
                SET account_id = EXCLUDED.account_id,
                    workspace_id = EXCLUDED.workspace_id,
                    status = 'ACTIVE',
                    claimed_at = EXCLUDED.claimed_at,
                    released_at = NULL
                WHERE commercial_license_claims.status = 'RELEASED'
                """.trimIndent()
            )
                .bind(0, licenseKey)
                .bind(1, UUID.fromString(accountId))
                .bind(2, UUID.fromString(workspaceId))
                .bind(3, now)
        )
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_workspace_memberships(
                    workspace_id, account_id, role, created_at, updated_at
                ) VALUES ($1, $2, 'OWNER', $3, $3)
                ON CONFLICT (workspace_id, account_id) DO UPDATE
                SET role = 'OWNER', updated_at = EXCLUDED.updated_at
                """.trimIndent()
            )
                .bind(0, UUID.fromString(workspaceId))
                .bind(1, UUID.fromString(accountId))
                .bind(2, now)
        )
        val claim = LicenseClaim(licenseKey, accountId, workspaceId, LicenseClaimStatus.ACTIVE, now)
        val membership = WorkspaceMembership(workspaceId, accountId, CommercialRole.OWNER, now, now)
        ClaimLicenseResult(ClaimLicenseOutcome.CLAIMED, claim, membership)
    }

    override suspend fun registerServer(
        accountId: String,
        licenseKey: String,
        stableServerId: String,
        displayName: String,
        instanceId: String,
        now: Instant
    ): RegisterServerResult = database.inTransaction { connection ->
        val claim = findActiveClaim(connection, licenseKey, forUpdate = true)
            ?.takeIf { it.accountId == accountId }
            ?: return@inTransaction RegisterServerResult(RegisterServerOutcome.LICENSE_NOT_CLAIMED_BY_ACCOUNT)
        val existing = queryOne(
            connection.createStatement(
                """
                SELECT * FROM commercial_server_instances
                WHERE license_key = $1 AND stable_server_id = $2
                FOR UPDATE
                """.trimIndent()
            ).bind(0, licenseKey).bind(1, stableServerId)
        ) { row, _ -> row.toServerInstance() }
        if (existing != null) {
            executeFully(
                connection.createStatement(
                    """
                    UPDATE commercial_server_instances
                    SET display_name = $3, last_seen_at = $4
                    WHERE license_key = $1 AND stable_server_id = $2
                    """.trimIndent()
                ).bind(0, licenseKey).bind(1, stableServerId).bind(2, displayName).bind(3, now)
            )
            return@inTransaction RegisterServerResult(
                RegisterServerOutcome.ALREADY_REGISTERED,
                existing.copy(displayName = displayName, lastSeenAt = now)
            )
        }
        val instance = ServerInstance(instanceId, licenseKey, claim.workspaceId, stableServerId, displayName, now, now)
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_server_instances(
                    instance_id, license_key, workspace_id, stable_server_id, display_name, created_at, last_seen_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $6)
                """.trimIndent()
            )
                .bind(0, UUID.fromString(instanceId))
                .bind(1, licenseKey)
                .bind(2, UUID.fromString(claim.workspaceId))
                .bind(3, stableServerId)
                .bind(4, displayName)
                .bind(5, now)
        )
        RegisterServerResult(RegisterServerOutcome.REGISTERED, instance)
    }

    override suspend fun findActiveClaim(licenseKey: String): LicenseClaim? = database.withConnection { connection ->
        findActiveClaim(connection, licenseKey, forUpdate = false)
    }

    override suspend fun listMemberships(workspaceId: String): List<WorkspaceMembership> =
        database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_workspace_memberships
                    WHERE workspace_id = $1 ORDER BY created_at, account_id
                    """.trimIndent()
                ).bind(0, UUID.fromString(workspaceId))
            ) { row, _ -> row.toMembership() }
        }

    override suspend fun listMembershipsForAccount(accountId: String): List<WorkspaceMembership> =
        database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_workspace_memberships
                    WHERE account_id = $1 ORDER BY created_at, workspace_id
                    """.trimIndent()
                ).bind(0, UUID.fromString(accountId))
            ) { row, _ -> row.toMembership() }
        }

    override suspend fun listServerInstances(workspaceId: String): List<ServerInstance> =
        database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_server_instances
                    WHERE workspace_id = $1 ORDER BY last_seen_at DESC, instance_id
                    """.trimIndent()
                ).bind(0, UUID.fromString(workspaceId))
            ) { row, _ -> row.toServerInstance() }
        }

    override suspend fun findServerInstance(instanceId: String): ServerInstance? =
        database.withConnection { connection ->
            queryOne(
                connection.createStatement("SELECT * FROM commercial_server_instances WHERE instance_id = $1")
                    .bind(0, UUID.fromString(instanceId))
            ) { row, _ -> row.toServerInstance() }
        }

    private suspend fun findActiveClaim(
        connection: Connection,
        licenseKey: String,
        forUpdate: Boolean
    ): LicenseClaim? {
        val suffix = if (forUpdate) " FOR UPDATE" else ""
        return queryOne(
            connection.createStatement(
                "SELECT * FROM commercial_license_claims WHERE license_key = $1 AND status = 'ACTIVE'$suffix"
            ).bind(0, licenseKey)
        ) { row, _ -> row.toClaim() }
    }

    private suspend fun findMembership(
        connection: Connection,
        workspaceId: String,
        accountId: String
    ): WorkspaceMembership? = queryOne(
        connection.createStatement(
            """
            SELECT * FROM commercial_workspace_memberships
            WHERE workspace_id = $1 AND account_id = $2
            """.trimIndent()
        ).bind(0, UUID.fromString(workspaceId)).bind(1, UUID.fromString(accountId))
    ) { row, _ -> row.toMembership() }
}

private fun Row.toClaim(): LicenseClaim = LicenseClaim(
    licenseKey = get("license_key", String::class.java)!!,
    accountId = get("account_id", UUID::class.java)!!.toString(),
    workspaceId = get("workspace_id", UUID::class.java)!!.toString(),
    status = LicenseClaimStatus.valueOf(get("status", String::class.java)!!),
    claimedAt = get("claimed_at", Instant::class.java)!!,
    releasedAt = get("released_at", Instant::class.java)
)

private fun Row.toMembership(): WorkspaceMembership = WorkspaceMembership(
    workspaceId = get("workspace_id", UUID::class.java)!!.toString(),
    accountId = get("account_id", UUID::class.java)!!.toString(),
    role = CommercialRole.valueOf(get("role", String::class.java)!!),
    createdAt = get("created_at", Instant::class.java)!!,
    updatedAt = get("updated_at", Instant::class.java)!!
)

private fun Row.toServerInstance(): ServerInstance = ServerInstance(
    id = get("instance_id", UUID::class.java)!!.toString(),
    licenseKey = get("license_key", String::class.java)!!,
    workspaceId = get("workspace_id", UUID::class.java)!!.toString(),
    stableServerId = get("stable_server_id", String::class.java)!!,
    displayName = get("display_name", String::class.java)!!,
    createdAt = get("created_at", Instant::class.java)!!,
    lastSeenAt = get("last_seen_at", Instant::class.java)!!
)
