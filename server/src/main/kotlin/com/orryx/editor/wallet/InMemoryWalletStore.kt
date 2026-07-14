package com.orryx.editor.wallet

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

class InMemoryWalletStore : WalletStore {
    private val mutex = Mutex()
    private val balances = mutableMapOf<String, WalletBalance>()
    private val entriesByBusinessKey = mutableMapOf<String, WalletLedgerEntry>()
    private val entries = mutableListOf<WalletLedgerEntry>()

    override suspend fun apply(
        command: WalletMutationCommand,
        entryId: String,
        now: Instant
    ): WalletMutationResult = mutex.withLock {
        val balance = balances[command.accountId] ?: WalletBalance(command.accountId, 0, 0)
        val replay = entriesByBusinessKey[command.businessKey]
        if (replay != null) {
            val sameOperation = replay.accountId == command.accountId &&
                replay.operationType == command.operationType &&
                operationAmount(replay) == command.amountCents
            return@withLock WalletMutationResult(
                if (sameOperation) WalletMutationOutcome.IDEMPOTENT_REPLAY else WalletMutationOutcome.IDEMPOTENCY_KEY_CONFLICT,
                balance,
                replay
            )
        }
        val deltas = calculateDeltas(balance, command)
            ?: return@withLock WalletMutationResult(WalletMutationOutcome.INSUFFICIENT_FUNDS, balance)
        val updated = WalletBalance(
            command.accountId,
            giftCents = Math.addExact(balance.giftCents, deltas.first),
            cashCents = Math.addExact(balance.cashCents, deltas.second)
        )
        val entry = WalletLedgerEntry(
            id = entryId,
            accountId = command.accountId,
            operationType = command.operationType,
            businessKey = command.businessKey,
            giftDeltaCents = deltas.first,
            cashDeltaCents = deltas.second,
            giftBalanceCents = updated.giftCents,
            cashBalanceCents = updated.cashCents,
            description = command.description,
            createdAt = now
        )
        balances[command.accountId] = updated
        entriesByBusinessKey[command.businessKey] = entry
        entries += entry
        WalletMutationResult(WalletMutationOutcome.APPLIED, updated, entry)
    }

    override suspend fun balance(accountId: String): WalletBalance = mutex.withLock {
        balances[accountId] ?: WalletBalance(accountId, 0, 0)
    }

    override suspend fun ledger(accountId: String, limit: Int): List<WalletLedgerEntry> = mutex.withLock {
        entries.asReversed().filter { it.accountId == accountId }.take(limit)
    }
}

internal fun calculateDeltas(
    balance: WalletBalance,
    command: WalletMutationCommand
): Pair<Long, Long>? = when (command.operationType) {
    WalletOperationType.CREDIT_GIFT -> {
        if (balance.giftCents > WalletMutationCommand.MAX_AMOUNT_CENTS - command.amountCents) null
        else command.amountCents to 0L
    }
    WalletOperationType.CREDIT_CASH -> {
        if (balance.cashCents > WalletMutationCommand.MAX_AMOUNT_CENTS - command.amountCents) null
        else 0L to command.amountCents
    }
    WalletOperationType.DEBIT -> {
        if (balance.availableCents < command.amountCents) null else {
            val giftDebit = minOf(balance.giftCents, command.amountCents)
            val cashDebit = command.amountCents - giftDebit
            -giftDebit to -cashDebit
        }
    }
    WalletOperationType.WITHDRAW_CASH -> {
        if (balance.cashCents < command.amountCents) null else 0L to -command.amountCents
    }
    WalletOperationType.RESERVE,
    WalletOperationType.CAPTURE,
    WalletOperationType.RELEASE -> null
}

internal fun operationAmount(entry: WalletLedgerEntry): Long = when (entry.operationType) {
    WalletOperationType.CREDIT_GIFT -> entry.giftDeltaCents
    WalletOperationType.CREDIT_CASH -> entry.cashDeltaCents
    WalletOperationType.DEBIT,
    WalletOperationType.WITHDRAW_CASH -> Math.negateExact(Math.addExact(entry.giftDeltaCents, entry.cashDeltaCents))
    WalletOperationType.RESERVE,
    WalletOperationType.CAPTURE,
    WalletOperationType.RELEASE -> 0L
}
