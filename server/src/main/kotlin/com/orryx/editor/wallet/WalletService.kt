package com.orryx.editor.wallet

import java.time.Clock
import java.util.UUID

interface WalletStore {
    suspend fun apply(command: WalletMutationCommand, entryId: String, now: java.time.Instant): WalletMutationResult
    suspend fun balance(accountId: String): WalletBalance
    suspend fun ledger(accountId: String, limit: Int): List<WalletLedgerEntry>
}

class WalletService(
    private val store: WalletStore,
    private val clock: Clock = Clock.systemUTC(),
    private val entryIdGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    suspend fun creditGift(
        accountId: String,
        amountCents: Long,
        businessKey: String,
        description: String
    ): WalletMutationResult = apply(accountId, WalletOperationType.CREDIT_GIFT, amountCents, businessKey, description)

    suspend fun creditCash(
        accountId: String,
        amountCents: Long,
        businessKey: String,
        description: String
    ): WalletMutationResult = apply(accountId, WalletOperationType.CREDIT_CASH, amountCents, businessKey, description)

    suspend fun debit(
        accountId: String,
        amountCents: Long,
        businessKey: String,
        description: String
    ): WalletMutationResult = apply(accountId, WalletOperationType.DEBIT, amountCents, businessKey, description)

    suspend fun withdrawCash(
        accountId: String,
        amountCents: Long,
        businessKey: String,
        description: String
    ): WalletMutationResult = apply(accountId, WalletOperationType.WITHDRAW_CASH, amountCents, businessKey, description)

    suspend fun balance(accountId: String): WalletBalance = store.balance(UUID.fromString(accountId).toString())

    suspend fun ledger(accountId: String, limit: Int = 100): List<WalletLedgerEntry> {
        require(limit in 1..500) { "limit must be between 1 and 500" }
        return store.ledger(UUID.fromString(accountId).toString(), limit)
    }

    private suspend fun apply(
        accountId: String,
        operationType: WalletOperationType,
        amountCents: Long,
        businessKey: String,
        description: String
    ): WalletMutationResult {
        val command = WalletMutationCommand(
            accountId = UUID.fromString(accountId).toString(),
            operationType = operationType,
            amountCents = amountCents,
            businessKey = businessKey,
            description = description.trim()
        )
        return store.apply(command, UUID.fromString(entryIdGenerator()).toString(), clock.instant())
    }
}
