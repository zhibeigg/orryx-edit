package com.orryx.editor.claim

import com.orryx.editor.rbac.CommercialRole
import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class ClaimServiceTest {
    @Test
    fun `license has one active owner and claimant becomes workspace owner`() = runTest {
        val licenseKey = "license-key-0001"
        val store = InMemoryCommercialTransactionStore(setOf(licenseKey))
        var workspaceSequence = 1
        val service = ClaimService(
            store = store,
            clock = Clock.fixed(Instant.parse("2025-01-01T00:00:00Z"), ZoneOffset.UTC),
            workspaceIdGenerator = {
                "20000000-0000-0000-0000-${(workspaceSequence++).toString().padStart(12, '0')}"
            },
            instanceIdGenerator = { "30000000-0000-0000-0000-000000000001" }
        )
        val owner = "10000000-0000-0000-0000-000000000001"
        val other = "10000000-0000-0000-0000-000000000002"

        val claimed = service.claim(ClaimLicenseCommand(owner, licenseKey))
        val replay = service.claim(ClaimLicenseCommand(owner, licenseKey))
        val rejected = service.claim(ClaimLicenseCommand(other, licenseKey))

        assertEquals(ClaimLicenseOutcome.CLAIMED, claimed.outcome)
        assertEquals(CommercialRole.OWNER, assertNotNull(claimed.membership).role)
        assertEquals(ClaimLicenseOutcome.ALREADY_OWNED, replay.outcome)
        assertEquals(claimed.claim?.workspaceId, replay.claim?.workspaceId)
        assertEquals(ClaimLicenseOutcome.OWNED_BY_ANOTHER_ACCOUNT, rejected.outcome)
        assertEquals(owner, rejected.claim?.accountId)
    }

    @Test
    fun `server instance is unique by license and stable server id`() = runTest {
        val licenseKey = "license-key-0002"
        val owner = "10000000-0000-0000-0000-000000000001"
        val store = InMemoryCommercialTransactionStore(setOf(licenseKey))
        var instanceSequence = 1
        val service = ClaimService(
            store = store,
            workspaceIdGenerator = { "20000000-0000-0000-0000-000000000001" },
            instanceIdGenerator = {
                "30000000-0000-0000-0000-${(instanceSequence++).toString().padStart(12, '0')}"
            }
        )
        service.claim(ClaimLicenseCommand(owner, licenseKey))

        val first = service.registerServer(RegisterServerCommand(owner, licenseKey, "server-prod-01", "Primary"))
        val replay = service.registerServer(RegisterServerCommand(owner, licenseKey, "server-prod-01", "Renamed"))

        assertEquals(RegisterServerOutcome.REGISTERED, first.outcome)
        assertEquals(RegisterServerOutcome.ALREADY_REGISTERED, replay.outcome)
        assertEquals(first.instance?.id, replay.instance?.id)
        assertEquals("Renamed", replay.instance?.displayName)
    }
}
