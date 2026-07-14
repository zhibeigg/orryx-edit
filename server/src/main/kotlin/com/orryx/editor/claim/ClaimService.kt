package com.orryx.editor.claim

import java.time.Clock
import java.util.UUID

class ClaimService(
    private val store: CommercialTransactionStore,
    private val clock: Clock = Clock.systemUTC(),
    private val workspaceIdGenerator: () -> String = { UUID.randomUUID().toString() },
    private val instanceIdGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    suspend fun claim(command: ClaimLicenseCommand): ClaimLicenseResult = store.claimLicense(
        accountId = UUID.fromString(command.accountId).toString(),
        licenseKey = command.licenseKey.trim(),
        workspaceId = UUID.fromString(workspaceIdGenerator()).toString(),
        now = clock.instant()
    )

    suspend fun registerServer(command: RegisterServerCommand): RegisterServerResult = store.registerServer(
        accountId = UUID.fromString(command.accountId).toString(),
        licenseKey = command.licenseKey.trim(),
        stableServerId = command.stableServerId,
        displayName = command.displayName.trim(),
        instanceId = UUID.fromString(instanceIdGenerator()).toString(),
        now = clock.instant()
    )

    suspend fun findClaim(licenseKey: String): LicenseClaim? {
        require(licenseKey.trim().length in 8..128) { "invalid licenseKey" }
        return store.findActiveClaim(licenseKey.trim())
    }

    suspend fun memberships(workspaceId: String): List<WorkspaceMembership> =
        store.listMemberships(UUID.fromString(workspaceId).toString())

    suspend fun membershipsForAccount(accountId: String): List<WorkspaceMembership> =
        store.listMembershipsForAccount(UUID.fromString(accountId).toString())

    suspend fun serverInstances(workspaceId: String): List<ServerInstance> =
        store.listServerInstances(UUID.fromString(workspaceId).toString())

    suspend fun findServerInstance(instanceId: String): ServerInstance? =
        store.findServerInstance(UUID.fromString(instanceId).toString())

    suspend fun canAccessServer(accountId: String, instanceId: String): Boolean {
        val normalizedAccountId = UUID.fromString(accountId).toString()
        val instance = findServerInstance(instanceId) ?: return false
        return memberships(instance.workspaceId).any { it.accountId == normalizedAccountId }
    }

    suspend fun registerClaimedServer(licenseKey: String, stableServerId: String, displayName: String): RegisterServerResult? {
        val claim = findClaim(licenseKey) ?: return null
        return registerServer(RegisterServerCommand(claim.accountId, claim.licenseKey, stableServerId, displayName))
    }
}
