package com.orryx.editor.wallet

import com.orryx.editor.auth.InstantIsoSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
enum class WalletBucket {
    GIFT,
    CASH
}

@Serializable
enum class WalletOperationType {
    CREDIT_GIFT,
    CREDIT_CASH,
    DEBIT,
    WITHDRAW_CASH,
    RESERVE,
    CAPTURE,
    RELEASE
}

@Serializable
data class WalletBalance(
    val accountId: String,
    val giftCents: Long,
    val cashCents: Long
) {
    init {
        require(giftCents >= 0 && cashCents >= 0) { "wallet balance cannot be negative" }
    }

    val availableCents: Long
        get() = Math.addExact(giftCents, cashCents)
}

@Serializable
data class WalletLedgerEntry(
    val id: String,
    val accountId: String,
    val operationType: WalletOperationType,
    val businessKey: String,
    val giftDeltaCents: Long,
    val cashDeltaCents: Long,
    val giftBalanceCents: Long,
    val cashBalanceCents: Long,
    val description: String,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant
)

@Serializable
enum class WalletMutationOutcome {
    APPLIED,
    IDEMPOTENT_REPLAY,
    IDEMPOTENCY_KEY_CONFLICT,
    INSUFFICIENT_FUNDS
}

@Serializable
data class WalletMutationResult(
    val outcome: WalletMutationOutcome,
    val balance: WalletBalance,
    val entry: WalletLedgerEntry? = null
)

@Serializable
data class WalletMutationCommand(
    val accountId: String,
    val operationType: WalletOperationType,
    val amountCents: Long,
    val businessKey: String,
    val description: String
) {
    init {
        require(operationType in SUPPORTED_OPERATIONS) { "operationType is not implemented" }
        require(amountCents in 1..MAX_AMOUNT_CENTS) { "amountCents must be positive and within limit" }
        require(businessKey.length in 1..128 && BUSINESS_KEY.matches(businessKey)) { "invalid businessKey" }
        require(description.trim().length in 1..160) { "description length must be between 1 and 160" }
    }

    companion object {
        const val MAX_AMOUNT_CENTS = 9_000_000_000_000_000L
        val SUPPORTED_OPERATIONS = setOf(
            WalletOperationType.CREDIT_GIFT,
            WalletOperationType.CREDIT_CASH,
            WalletOperationType.DEBIT,
            WalletOperationType.WITHDRAW_CASH
        )
        private val BUSINESS_KEY = Regex("^[A-Za-z0-9._:-]+$")
    }
}
