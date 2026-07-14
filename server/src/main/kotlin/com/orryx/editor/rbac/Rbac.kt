package com.orryx.editor.rbac

import kotlinx.serialization.Serializable

@Serializable
enum class CommercialPermission {
    WORKSPACE_READ,
    WORKSPACE_MANAGE,
    WORKSPACE_TRANSFER_OWNERSHIP,
    MEMBERSHIP_READ,
    MEMBERSHIP_MANAGE,
    LICENSE_CLAIM,
    SERVER_INSTANCE_READ,
    SERVER_INSTANCE_MANAGE,
    ENTITLEMENT_READ,
    WALLET_READ,
    WALLET_SPEND,
    PAYMENT_CREATE,
    AUDIT_READ
}

@Serializable
enum class CommercialRole {
    OWNER,
    ADMIN,
    MEMBER
}

@Serializable
data class RoleDefinition(
    val role: CommercialRole,
    val permissions: Set<CommercialPermission>
)

object BuiltInRoles {
    val OWNER = RoleDefinition(
        CommercialRole.OWNER,
        CommercialPermission.entries.toSet()
    )

    val ADMIN = RoleDefinition(
        CommercialRole.ADMIN,
        setOf(
            CommercialPermission.WORKSPACE_READ,
            CommercialPermission.WORKSPACE_MANAGE,
            CommercialPermission.MEMBERSHIP_READ,
            CommercialPermission.MEMBERSHIP_MANAGE,
            CommercialPermission.LICENSE_CLAIM,
            CommercialPermission.SERVER_INSTANCE_READ,
            CommercialPermission.SERVER_INSTANCE_MANAGE,
            CommercialPermission.ENTITLEMENT_READ,
            CommercialPermission.WALLET_READ,
            CommercialPermission.WALLET_SPEND,
            CommercialPermission.PAYMENT_CREATE,
            CommercialPermission.AUDIT_READ
        )
    )

    val MEMBER = RoleDefinition(
        CommercialRole.MEMBER,
        setOf(
            CommercialPermission.WORKSPACE_READ,
            CommercialPermission.MEMBERSHIP_READ,
            CommercialPermission.SERVER_INSTANCE_READ,
            CommercialPermission.ENTITLEMENT_READ,
            CommercialPermission.WALLET_READ
        )
    )

    private val definitions = listOf(OWNER, ADMIN, MEMBER).associateBy(RoleDefinition::role)

    fun definition(role: CommercialRole): RoleDefinition = definitions.getValue(role)
}

class PermissionEvaluator {
    fun isAllowed(role: CommercialRole, permission: CommercialPermission): Boolean =
        permission in BuiltInRoles.definition(role).permissions

    fun requireAllowed(role: CommercialRole, permission: CommercialPermission) {
        require(isAllowed(role, permission)) { "role $role does not have permission $permission" }
    }
}
