package com.orryx.editor.claim

import com.orryx.editor.auth.InstantIsoSerializer
import com.orryx.editor.rbac.CommercialRole
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
enum class LicenseClaimStatus {
    ACTIVE,
    RELEASED
}

@Serializable
data class LicenseClaim(
    val licenseKey: String,
    val accountId: String,
    val workspaceId: String,
    val status: LicenseClaimStatus,
    @Serializable(with = InstantIsoSerializer::class)
    val claimedAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val releasedAt: Instant? = null
)

@Serializable
data class ServerInstance(
    val id: String,
    val licenseKey: String,
    val workspaceId: String,
    val stableServerId: String,
    val displayName: String,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val lastSeenAt: Instant
)

@Serializable
data class WorkspaceMembership(
    val workspaceId: String,
    val accountId: String,
    val role: CommercialRole,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val updatedAt: Instant
)

@Serializable
enum class ClaimLicenseOutcome {
    CLAIMED,
    ALREADY_OWNED,
    OWNED_BY_ANOTHER_ACCOUNT,
    LICENSE_NOT_FOUND_OR_INACTIVE
}

@Serializable
data class ClaimLicenseResult(
    val outcome: ClaimLicenseOutcome,
    val claim: LicenseClaim? = null,
    val membership: WorkspaceMembership? = null
)

@Serializable
enum class RegisterServerOutcome {
    REGISTERED,
    ALREADY_REGISTERED,
    LICENSE_NOT_CLAIMED_BY_ACCOUNT
}

@Serializable
data class RegisterServerResult(
    val outcome: RegisterServerOutcome,
    val instance: ServerInstance? = null
)

@Serializable
data class ClaimLicenseCommand(
    val accountId: String,
    val licenseKey: String
) {
    init {
        require(licenseKey.trim().length in 8..128) { "licenseKey length must be between 8 and 128" }
    }
}

@Serializable
data class RegisterServerCommand(
    val accountId: String,
    val licenseKey: String,
    val stableServerId: String,
    val displayName: String
) {
    init {
        require(licenseKey.trim().length in 8..128) { "licenseKey length must be between 8 and 128" }
        require(stableServerId.length in 8..128 && STABLE_ID.matches(stableServerId)) { "invalid stableServerId" }
        require(displayName.trim().length in 1..80) { "displayName length must be between 1 and 80" }
    }

    private companion object {
        val STABLE_ID = Regex("^[A-Za-z0-9._:-]+$")
    }
}
