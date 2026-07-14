package com.orryx.editor.ai

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresAiAccessPolicy(
    private val database: R2dbcDatabase,
    private val reservationCents: Long
) : AiAccessPolicy {
    init {
        require(reservationCents in 0..1_000_000L) { "AI usage reservation 超出允许范围" }
    }

    override suspend fun authorize(request: AiAccessRequest): AiAccessReservation = database.inTransaction { connection ->
        requireAccountAccess(connection, request)
        existingReservation(connection, request.jobId)?.let { existing ->
            if (existing.status != ReservationStatus.RESERVED) {
                throw AiAccessException(AiJobErrorCode.INVALID_STATE)
            }
            return@inTransaction AiAccessReservation(existing.id.toString())
        }

        ensureWallet(connection, request.accountId, Instant.now())
        val balance = lockWallet(connection, request.accountId)
        if (balance.giftCents + balance.cashCents < reservationCents) {
            throw AiAccessException(AiJobErrorCode.BILLING_FAILED)
        }
        val giftReserved = minOf(balance.giftCents, reservationCents)
        val cashReserved = reservationCents - giftReserved
        val updated = WalletRow(balance.giftCents - giftReserved, balance.cashCents - cashReserved)
        updateWallet(connection, request.accountId, updated, Instant.now())
        appendLedger(
            connection = connection,
            accountId = request.accountId,
            operation = "RESERVE",
            businessKey = "ai:${request.jobId}:reserve",
            giftDelta = -giftReserved,
            cashDelta = -cashReserved,
            balance = updated,
            description = "AI usage reservation",
            now = Instant.now()
        )

        val reservationId = UUID.randomUUID()
        executeFully(
            connection.createStatement(
                """
                INSERT INTO ai_usage_reservations(
                    id, account_id, job_id, reserved_gift_cents, reserved_cash_cents,
                    captured_cents, status, idempotency_key, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, NULL, 'RESERVED', $6, $7, $7)
                """.trimIndent()
            )
                .bind(0, reservationId)
                .bind(1, request.accountId)
                .bind(2, request.jobId)
                .bind(3, giftReserved)
                .bind(4, cashReserved)
                .bind(5, request.idempotencyKey)
                .bind(6, Instant.now())
        )
        AiAccessReservation(reservationId.toString())
    }

    override suspend fun capture(
        reservation: AiAccessReservation,
        usage: AiProviderUsage,
        costAmount: Long,
        now: Instant
    ) {
        require(costAmount >= 0) { "AI costAmount 不能为负数" }
        database.inTransaction { connection ->
            val stored = lockReservation(connection, reservation)
            if (stored.status == ReservationStatus.CAPTURED) {
                if (stored.capturedCents != costAmount) throw AiAccessException(AiJobErrorCode.BILLING_FAILED)
                return@inTransaction
            }
            if (stored.status == ReservationStatus.RELEASED) throw AiAccessException(AiJobErrorCode.INVALID_STATE)

            val balance = lockWallet(connection, stored.accountId)
            val reservedTotal = Math.addExact(stored.giftCents, stored.cashCents)
            val updated = if (costAmount <= reservedTotal) {
                val consumedGift = minOf(costAmount, stored.giftCents)
                val consumedCash = costAmount - consumedGift
                WalletRow(
                    giftCents = Math.addExact(balance.giftCents, stored.giftCents - consumedGift),
                    cashCents = Math.addExact(balance.cashCents, stored.cashCents - consumedCash)
                )
            } else {
                val extra = costAmount - reservedTotal
                if (balance.giftCents + balance.cashCents < extra) {
                    throw AiAccessException(AiJobErrorCode.BILLING_FAILED)
                }
                val extraGift = minOf(balance.giftCents, extra)
                val extraCash = extra - extraGift
                WalletRow(balance.giftCents - extraGift, balance.cashCents - extraCash)
            }
            updateWallet(connection, stored.accountId, updated, now)
            appendLedger(
                connection = connection,
                accountId = stored.accountId,
                operation = "CAPTURE",
                businessKey = "ai:${stored.jobId}:capture",
                giftDelta = updated.giftCents - balance.giftCents,
                cashDelta = updated.cashCents - balance.cashCents,
                balance = updated,
                description = "AI usage capture: ${usage.inputTokens}/${usage.outputTokens} tokens",
                now = now
            )
            executeFully(
                connection.createStatement(
                    """
                    UPDATE ai_usage_reservations
                    SET status = 'CAPTURED', captured_cents = $2, updated_at = $3
                    WHERE id = $1 AND status = 'RESERVED'
                    """.trimIndent()
                ).bind(0, stored.id).bind(1, costAmount).bind(2, now)
            )
        }
    }

    override suspend fun release(reservation: AiAccessReservation, reasonCode: String, now: Instant) {
        database.inTransaction { connection ->
            val stored = lockReservation(connection, reservation)
            if (stored.status != ReservationStatus.RESERVED) return@inTransaction
            val balance = lockWallet(connection, stored.accountId)
            val updated = WalletRow(
                giftCents = Math.addExact(balance.giftCents, stored.giftCents),
                cashCents = Math.addExact(balance.cashCents, stored.cashCents)
            )
            updateWallet(connection, stored.accountId, updated, now)
            appendLedger(
                connection = connection,
                accountId = stored.accountId,
                operation = "RELEASE",
                businessKey = "ai:${stored.jobId}:release",
                giftDelta = stored.giftCents,
                cashDelta = stored.cashCents,
                balance = updated,
                description = "AI usage release: ${reasonCode.take(100)}",
                now = now
            )
            executeFully(
                connection.createStatement(
                    """
                    UPDATE ai_usage_reservations
                    SET status = 'RELEASED', updated_at = $2
                    WHERE id = $1 AND status = 'RESERVED'
                    """.trimIndent()
                ).bind(0, stored.id).bind(1, now)
            )
        }
    }

    private suspend fun requireAccountAccess(connection: Connection, request: AiAccessRequest) {
        val entitled = queryOne(
            connection.createStatement(
                """
                SELECT 1 FROM commercial_entitlements
                WHERE account_id = $1 AND entitlement_type = 'AI_EDITOR_PERMANENT'
                """.trimIndent()
            ).bind(0, request.accountId)
        ) { _, _ -> true } ?: false
        if (!entitled) throw AiAccessException(AiJobErrorCode.ACCESS_DENIED)

        val ownsServer = queryOne(
            connection.createStatement(
                """
                SELECT 1
                FROM commercial_server_instances si
                JOIN commercial_workspace_memberships wm ON wm.workspace_id = si.workspace_id
                WHERE si.instance_id = $1 AND wm.account_id = $2
                """.trimIndent()
            ).bind(0, request.serverInstanceId).bind(1, request.accountId)
        ) { _, _ -> true } ?: false
        if (!ownsServer) throw AiAccessException(AiJobErrorCode.ACCESS_DENIED)
    }

    private suspend fun existingReservation(connection: Connection, jobId: UUID): ReservationRow? = queryOne(
        connection.createStatement("SELECT * FROM ai_usage_reservations WHERE job_id = $1").bind(0, jobId)
    ) { row, _ -> row.toReservation() }

    private suspend fun lockReservation(connection: Connection, reservation: AiAccessReservation): ReservationRow =
        queryOne(
            connection.createStatement("SELECT * FROM ai_usage_reservations WHERE id = $1 FOR UPDATE")
                .bind(0, UUID.fromString(reservation.reservationId))
        ) { row, _ -> row.toReservation() } ?: throw AiAccessException(AiJobErrorCode.INVALID_STATE)

    private suspend fun ensureWallet(connection: Connection, accountId: UUID, now: Instant) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallets(account_id, gift_cents, cash_cents, updated_at)
                VALUES ($1, 0, 0, $2)
                ON CONFLICT (account_id) DO NOTHING
                """.trimIndent()
            ).bind(0, accountId).bind(1, now)
        )
    }

    private suspend fun lockWallet(connection: Connection, accountId: UUID): WalletRow = queryOne(
        connection.createStatement(
            "SELECT gift_cents, cash_cents FROM commercial_wallets WHERE account_id = $1 FOR UPDATE"
        ).bind(0, accountId)
    ) { row, _ ->
        WalletRow(
            row.get("gift_cents", java.lang.Long::class.java)!!.toLong(),
            row.get("cash_cents", java.lang.Long::class.java)!!.toLong()
        )
    } ?: throw AiAccessException(AiJobErrorCode.BILLING_FAILED)

    private suspend fun updateWallet(connection: Connection, accountId: UUID, balance: WalletRow, now: Instant) {
        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_wallets
                SET gift_cents = $2, cash_cents = $3, updated_at = $4
                WHERE account_id = $1
                """.trimIndent()
            ).bind(0, accountId).bind(1, balance.giftCents).bind(2, balance.cashCents).bind(3, now)
        )
    }

    private suspend fun appendLedger(
        connection: Connection,
        accountId: UUID,
        operation: String,
        businessKey: String,
        giftDelta: Long,
        cashDelta: Long,
        balance: WalletRow,
        description: String,
        now: Instant
    ) {
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallet_ledger(
                    entry_id, account_id, operation_type, business_key, gift_delta_cents, cash_delta_cents,
                    gift_balance_cents, cash_balance_cents, description, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (business_key) DO NOTHING
                """.trimIndent()
            )
                .bind(0, UUID.randomUUID())
                .bind(1, accountId)
                .bind(2, operation)
                .bind(3, businessKey)
                .bind(4, giftDelta)
                .bind(5, cashDelta)
                .bind(6, balance.giftCents)
                .bind(7, balance.cashCents)
                .bind(8, description.take(160))
                .bind(9, now)
        )
    }

    private data class WalletRow(val giftCents: Long, val cashCents: Long)
    private data class ReservationRow(
        val id: UUID,
        val accountId: UUID,
        val jobId: UUID,
        val giftCents: Long,
        val cashCents: Long,
        val capturedCents: Long?,
        val status: ReservationStatus
    )

    private enum class ReservationStatus { RESERVED, CAPTURED, RELEASED }

    private fun Row.toReservation(): ReservationRow = ReservationRow(
        id = get("id", UUID::class.java)!!,
        accountId = get("account_id", UUID::class.java)!!,
        jobId = get("job_id", UUID::class.java)!!,
        giftCents = get("reserved_gift_cents", java.lang.Long::class.java)!!.toLong(),
        cashCents = get("reserved_cash_cents", java.lang.Long::class.java)!!.toLong(),
        capturedCents = get("captured_cents", java.lang.Long::class.java)?.toLong(),
        status = ReservationStatus.valueOf(get("status", String::class.java)!!)
    )
}
