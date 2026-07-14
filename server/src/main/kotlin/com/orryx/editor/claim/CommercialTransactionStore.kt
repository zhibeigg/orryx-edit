package com.orryx.editor.claim

import java.time.Instant

/**
 * Every method is one atomic commercial transaction. Implementations must not compose repository calls
 * that each open their own transaction.
 */
interface CommercialTransactionStore {
    suspend fun claimLicense(
        accountId: String,
        licenseKey: String,
        workspaceId: String,
        now: Instant
    ): ClaimLicenseResult

    suspend fun registerServer(
        accountId: String,
        licenseKey: String,
        stableServerId: String,
        displayName: String,
        instanceId: String,
        now: Instant
    ): RegisterServerResult

    suspend fun findActiveClaim(licenseKey: String): LicenseClaim?
    suspend fun listMemberships(workspaceId: String): List<WorkspaceMembership>
    suspend fun listMembershipsForAccount(accountId: String): List<WorkspaceMembership>
    suspend fun listServerInstances(workspaceId: String): List<ServerInstance>
    suspend fun findServerInstance(instanceId: String): ServerInstance?
}
