package com.orryx.editor.wallet

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresWalletStore(private val database: R2dbcDatabase) : WalletStore {
    override suspend fun apply(
        command: WalletMutationCommand,
        entryId: String,
        now: Instant
    ): WalletMutationResult = database.inTransaction { connection ->
        queryOne(
            connection.createStatement("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
                .bind(0, command.businessKey)
        ) { _, _ -> true }
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallets(account_id, gift_cents, cash_cents, updated_at)
                VALUES ($1, 0, 0, $2)
                ON CONFLICT (account_id) DO NOTHING
                """.trimIndent()
            ).bind(0, UUID.fromString(command.accountId)).bind(1, now)
        )
        val balance = lockBalance(connection, command.accountId)
        val replay = queryOne(
            connection.createStatement(
                "SELECT * FROM commercial_wallet_ledger WHERE business_key = $1"
            ).bind(0, command.businessKey)
        ) { row, _ -> row.toWalletEntry() }
        if (replay != null) {
            val sameOperation = replay.accountId == command.accountId &&
                replay.operationType == command.operationType &&
                operationAmount(replay) == command.amountCents
            return@inTransaction WalletMutationResult(
                if (sameOperation) WalletMutationOutcome.IDEMPOTENT_REPLAY else WalletMutationOutcome.IDEMPOTENCY_KEY_CONFLICT,
                balance,
                replay
            )
        }
        val deltas = calculateDeltas(balance, command)
            ?: return@inTransaction WalletMutationResult(WalletMutationOutcome.INSUFFICIENT_FUNDS, balance)
        val updated = WalletBalance(
            command.accountId,
            giftCents = Math.addExact(balance.giftCents, deltas.first),
            cashCents = Math.addExact(balance.cashCents, deltas.second)
        )
        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_wallets
                SET gift_cents = $2, cash_cents = $3, updated_at = $4
                WHERE account_id = $1
                """.trimIndent()
            )
                .bind(0, UUID.fromString(command.accountId))
                .bind(1, updated.giftCents)
                .bind(2, updated.cashCents)
                .bind(3, now)
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
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallet_ledger(
                    entry_id, account_id, operation_type, business_key, gift_delta_cents, cash_delta_cents,
                    gift_balance_cents, cash_balance_cents, description, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """.trimIndent()
            )
                .bind(0, UUID.fromString(entry.id))
                .bind(1, UUID.fromString(entry.accountId))
                .bind(2, entry.operationType.name)
                .bind(3, entry.businessKey)
                .bind(4, entry.giftDeltaCents)
                .bind(5, entry.cashDeltaCents)
                .bind(6, entry.giftBalanceCents)
                .bind(7, entry.cashBalanceCents)
                .bind(8, entry.description)
                .bind(9, entry.createdAt)
        )
        WalletMutationResult(WalletMutationOutcome.APPLIED, updated, entry)
    }

    override suspend fun balance(accountId: String): WalletBalance = database.withConnection { connection ->
        queryOne(
            connection.createStatement("SELECT * FROM commercial_wallets WHERE account_id = $1")
                .bind(0, UUID.fromString(accountId))
        ) { row, _ -> row.toBalance() } ?: WalletBalance(accountId, 0, 0)
    }

    override suspend fun ledger(accountId: String, limit: Int): List<WalletLedgerEntry> =
        database.withConnection { connection ->
            queryAll(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_wallet_ledger
                    WHERE account_id = $1 ORDER BY created_at DESC, entry_id DESC LIMIT $2
                    """.trimIndent()
                ).bind(0, UUID.fromString(accountId)).bind(1, limit)
            ) { row, _ -> row.toWalletEntry() }
        }

    private suspend fun lockBalance(connection: Connection, accountId: String): WalletBalance = queryOne(
        connection.createStatement("SELECT * FROM commercial_wallets WHERE account_id = $1 FOR UPDATE")
            .bind(0, UUID.fromString(accountId))
    ) { row, _ -> row.toBalance() } ?: error("wallet row was not created")
}

private fun Row.toBalance(): WalletBalance = WalletBalance(
    accountId = get("account_id", UUID::class.java)!!.toString(),
    giftCents = get("gift_cents", java.lang.Long::class.java)!!.toLong(),
    cashCents = get("cash_cents", java.lang.Long::class.java)!!.toLong()
)

private fun Row.toWalletEntry(): WalletLedgerEntry = WalletLedgerEntry(
    id = get("entry_id", UUID::class.java)!!.toString(),
    accountId = get("account_id", UUID::class.java)!!.toString(),
    operationType = WalletOperationType.valueOf(get("operation_type", String::class.java)!!),
    businessKey = get("business_key", String::class.java)!!,
    giftDeltaCents = get("gift_delta_cents", java.lang.Long::class.java)!!.toLong(),
    cashDeltaCents = get("cash_delta_cents", java.lang.Long::class.java)!!.toLong(),
    giftBalanceCents = get("gift_balance_cents", java.lang.Long::class.java)!!.toLong(),
    cashBalanceCents = get("cash_balance_cents", java.lang.Long::class.java)!!.toLong(),
    description = get("description", String::class.java)!!,
    createdAt = get("created_at", Instant::class.java)!!
)
