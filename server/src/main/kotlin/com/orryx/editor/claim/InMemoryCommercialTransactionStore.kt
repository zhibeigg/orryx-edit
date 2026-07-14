package com.orryx.editor.claim

import com.orryx.editor.rbac.CommercialRole
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

class InMemoryCommercialTransactionStore(
    validLicenseKeys: Set<String> = emptySet()
) : CommercialTransactionStore {
    private val mutex = Mutex()
    private val validLicenses = validLicenseKeys.toMutableSet()
    private val claims = mutableMapOf<String, LicenseClaim>()
    private val memberships = mutableMapOf<Pair<String, String>, WorkspaceMembership>()
    private val instances = mutableMapOf<Pair<String, String>, ServerInstance>()

    suspend fun addValidLicense(licenseKey: String) = mutex.withLock {
        require(licenseKey.length in 8..128)
        validLicenses += licenseKey
    }

    override suspend fun claimLicense(
        accountId: String,
        licenseKey: String,
        workspaceId: String,
        now: Instant
    ): ClaimLicenseResult = mutex.withLock {
        if (licenseKey !in validLicenses) {
            return@withLock ClaimLicenseResult(ClaimLicenseOutcome.LICENSE_NOT_FOUND_OR_INACTIVE)
        }
        val existing = claims[licenseKey]?.takeIf { it.status == LicenseClaimStatus.ACTIVE }
        if (existing != null) {
            return@withLock if (existing.accountId == accountId) {
                ClaimLicenseResult(
                    ClaimLicenseOutcome.ALREADY_OWNED,
                    existing,
                    memberships[existing.workspaceId to accountId]
                )
            } else {
                ClaimLicenseResult(ClaimLicenseOutcome.OWNED_BY_ANOTHER_ACCOUNT, existing)
            }
        }
        val claim = LicenseClaim(licenseKey, accountId, workspaceId, LicenseClaimStatus.ACTIVE, now)
        val membership = WorkspaceMembership(workspaceId, accountId, CommercialRole.OWNER, now, now)
        claims[licenseKey] = claim
        memberships[workspaceId to accountId] = membership
        ClaimLicenseResult(ClaimLicenseOutcome.CLAIMED, claim, membership)
    }

    override suspend fun registerServer(
        accountId: String,
        licenseKey: String,
        stableServerId: String,
        displayName: String,
        instanceId: String,
        now: Instant
    ): RegisterServerResult = mutex.withLock {
        val claim = claims[licenseKey]?.takeIf {
            it.status == LicenseClaimStatus.ACTIVE && it.accountId == accountId
        } ?: return@withLock RegisterServerResult(RegisterServerOutcome.LICENSE_NOT_CLAIMED_BY_ACCOUNT)
        val key = licenseKey to stableServerId
        val existing = instances[key]
        if (existing != null) {
            val touched = existing.copy(displayName = displayName, lastSeenAt = now)
            instances[key] = touched
            return@withLock RegisterServerResult(RegisterServerOutcome.ALREADY_REGISTERED, touched)
        }
        val instance = ServerInstance(instanceId, licenseKey, claim.workspaceId, stableServerId, displayName, now, now)
        instances[key] = instance
        RegisterServerResult(RegisterServerOutcome.REGISTERED, instance)
    }

    override suspend fun findActiveClaim(licenseKey: String): LicenseClaim? = mutex.withLock {
        claims[licenseKey]?.takeIf { it.status == LicenseClaimStatus.ACTIVE }
    }

    override suspend fun listMemberships(workspaceId: String): List<WorkspaceMembership> = mutex.withLock {
        memberships.values.filter { it.workspaceId == workspaceId }.sortedBy { it.createdAt }
    }

    override suspend fun listMembershipsForAccount(accountId: String): List<WorkspaceMembership> = mutex.withLock {
        memberships.values.filter { it.accountId == accountId }.sortedBy { it.createdAt }
    }

    override suspend fun listServerInstances(workspaceId: String): List<ServerInstance> = mutex.withLock {
        instances.values.filter { it.workspaceId == workspaceId }.sortedByDescending { it.lastSeenAt }
    }

    override suspend fun findServerInstance(instanceId: String): ServerInstance? = mutex.withLock {
        instances.values.firstOrNull { it.id == instanceId }
    }
}
