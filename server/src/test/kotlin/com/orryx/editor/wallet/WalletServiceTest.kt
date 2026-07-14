package com.orryx.editor.wallet

import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals

class WalletServiceTest {
    @Test
    fun `sequential operations preserve atomic no-overdraft and idempotency semantics`() = runTest {
        var sequence = 1
        val accountId = "10000000-0000-0000-0000-000000000001"
        val service = WalletService(
            store = InMemoryWalletStore(),
            clock = Clock.fixed(Instant.parse("2025-01-01T00:00:00Z"), ZoneOffset.UTC),
            entryIdGenerator = {
                "40000000-0000-0000-0000-${(sequence++).toString().padStart(12, '0')}"
            }
        )

        assertEquals(
            WalletMutationOutcome.APPLIED,
            service.creditGift(accountId, 5_000, "gift:initial", "Initial gift").outcome
        )
        assertEquals(
            WalletMutationOutcome.APPLIED,
            service.creditCash(accountId, 3_000, "cash:initial", "Initial cash").outcome
        )
        val debit = service.debit(accountId, 6_000, "usage:one", "AI usage")
        assertEquals(WalletMutationOutcome.APPLIED, debit.outcome)
        assertEquals(0, debit.balance.giftCents)
        assertEquals(2_000, debit.balance.cashCents)
        assertEquals(-5_000, debit.entry?.giftDeltaCents)
        assertEquals(-1_000, debit.entry?.cashDeltaCents)

        val replay = service.debit(accountId, 6_000, "usage:one", "Ignored replay description")
        assertEquals(WalletMutationOutcome.IDEMPOTENT_REPLAY, replay.outcome)
        assertEquals(2_000, replay.balance.availableCents)
        assertEquals(3, service.ledger(accountId).size)

        val conflict = service.debit(accountId, 1_000, "usage:one", "Different amount")
        assertEquals(WalletMutationOutcome.IDEMPOTENCY_KEY_CONFLICT, conflict.outcome)
        assertEquals(2_000, conflict.balance.availableCents)

        val overdraft = service.debit(accountId, 2_001, "usage:two", "Too much")
        assertEquals(WalletMutationOutcome.INSUFFICIENT_FUNDS, overdraft.outcome)
        assertEquals(2_000, overdraft.balance.availableCents)
    }

    @Test
    fun `gift balance cannot be withdrawn as cash`() = runTest {
        val accountId = "10000000-0000-0000-0000-000000000001"
        val service = WalletService(
            store = InMemoryWalletStore(),
            entryIdGenerator = { "40000000-0000-0000-0000-000000000001" }
        )
        service.creditGift(accountId, 5_000, "gift:only", "Gift only")

        val withdrawal = service.withdrawCash(accountId, 1, "withdraw:one", "Cash withdrawal")

        assertEquals(WalletMutationOutcome.INSUFFICIENT_FUNDS, withdrawal.outcome)
        assertEquals(5_000, withdrawal.balance.giftCents)
        assertEquals(0, withdrawal.balance.cashCents)
    }
}
