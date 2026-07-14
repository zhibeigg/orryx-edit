package com.orryx.editor.payment

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant
import java.util.UUID

class PostgresPaymentSettlementStore(
    private val database: R2dbcDatabase
) : PaymentSettlementStore {
    override suspend fun createOrder(order: PaymentOrder): PaymentOrderCreateResult =
        database.inTransaction { connection ->
            advisoryLock(connection, "payment-request:${order.requestKey}")
            advisoryLock(connection, "payment-product:${order.accountId}:${order.productId.name}")
            val existing = queryOne(
                connection.createStatement("SELECT * FROM commercial_payment_orders WHERE request_key = $1")
                    .bind(0, order.requestKey)
            ) { row, _ -> row.toPaymentOrder() }
            if (existing != null) {
                val sameRequest = existing.accountId == order.accountId &&
                    existing.productId == order.productId &&
                    existing.provider == order.provider
                return@inTransaction PaymentOrderCreateResult(
                    if (sameRequest) PaymentOrderCreateOutcome.IDEMPOTENT_REPLAY
                    else PaymentOrderCreateOutcome.IDEMPOTENCY_KEY_CONFLICT,
                    existing
                )
            }
            val active = queryOne(
                connection.createStatement(
                    """
                    SELECT * FROM commercial_payment_orders
                    WHERE account_id = $1 AND product_id = $2 AND provider = $3 AND status = 'PENDING'
                    ORDER BY created_at, order_id LIMIT 1
                    """.trimIndent()
                )
                    .bind(0, UUID.fromString(order.accountId))
                    .bind(1, order.productId.name)
                    .bind(2, order.provider.name)
            ) { row, _ -> row.toPaymentOrder() }
            if (active != null) {
                return@inTransaction PaymentOrderCreateResult(PaymentOrderCreateOutcome.ACTIVE_ORDER_EXISTS, active)
            }
            val inserted = executeFully(
                connection.createStatement(
                    """
                    INSERT INTO commercial_payment_orders(
                        order_id, merchant_order_no, request_key, account_id, product_id, provider,
                        amount_cents, gift_cents, status, provider_transaction_id, created_at, paid_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', NULL, $9, NULL)
                    ON CONFLICT DO NOTHING
                    """.trimIndent()
                )
                    .bind(0, UUID.fromString(order.id))
                    .bind(1, order.merchantOrderNo)
                    .bind(2, order.requestKey)
                    .bind(3, UUID.fromString(order.accountId))
                    .bind(4, order.productId.name)
                    .bind(5, order.provider.name)
                    .bind(6, order.amountCents)
                    .bind(7, order.giftCents)
                    .bind(8, order.createdAt)
            )
            check(inserted == 1L) { "payment order identifier collision" }
            PaymentOrderCreateResult(PaymentOrderCreateOutcome.CREATED, order)
        }

    override suspend fun findByMerchantOrderNo(merchantOrderNo: String): PaymentOrder? =
        database.withConnection { connection ->
            queryOne(
                connection.createStatement("SELECT * FROM commercial_payment_orders WHERE merchant_order_no = $1")
                    .bind(0, merchantOrderNo)
            ) { row, _ -> row.toPaymentOrder() }
        }

    override suspend fun settlePaid(
        notification: ValidatedPaymentNotification,
        paidAt: Instant,
        entitlementId: String,
        giftLedgerEntryId: String
    ): PaymentSettlementResult = database.inTransaction { connection ->
        advisoryLock(connection, "provider-transaction:${notification.providerTransactionId}")
        val order = queryOne(
            connection.createStatement(
                "SELECT * FROM commercial_payment_orders WHERE merchant_order_no = $1 FOR UPDATE"
            ).bind(0, notification.merchantOrderNo)
        ) { row, _ -> row.toPaymentOrder() } ?: error("payment order not found")
        if (order.amountCents != notification.amountCents) {
            return@inTransaction PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }
        if (order.status == PaymentOrderStatus.PAID) {
            val outcome = if (order.providerTransactionId == notification.providerTransactionId) {
                PaymentSettlementOutcome.ALREADY_PAID
            } else {
                PaymentSettlementOutcome.REJECTED
            }
            return@inTransaction PaymentSettlementResult(outcome, order)
        }
        if (order.status != PaymentOrderStatus.PENDING || order.productId != ProductId.AI_PERMANENT_99) {
            return@inTransaction PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }
        val transactionUsed = queryOne(
            connection.createStatement(
                """
                SELECT merchant_order_no FROM commercial_payment_orders
                WHERE provider = $1 AND provider_transaction_id = $2
                """.trimIndent()
            ).bind(0, order.provider.name).bind(1, notification.providerTransactionId)
        ) { row, _ -> row.get("merchant_order_no", String::class.java)!! }
        if (transactionUsed != null && transactionUsed != order.merchantOrderNo) {
            return@inTransaction PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }

        executeFully(
            connection.createStatement(
                """
                UPDATE commercial_payment_orders
                SET status = 'PAID', provider_transaction_id = $2, paid_at = $3
                WHERE order_id = $1
                """.trimIndent()
            )
                .bind(0, UUID.fromString(order.id))
                .bind(1, notification.providerTransactionId)
                .bind(2, paidAt)
        )
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_entitlements(
                    entitlement_id, account_id, entitlement_type, source_type, source_id, granted_at
                ) VALUES ($1, $2, 'AI_EDITOR_PERMANENT', 'PAYMENT', $3, $4)
                ON CONFLICT DO NOTHING
                """.trimIndent()
            )
                .bind(0, UUID.fromString(entitlementId))
                .bind(1, UUID.fromString(order.accountId))
                .bind(2, order.id)
                .bind(3, paidAt)
        )
        grantGiftIfAbsent(connection, order, giftLedgerEntryId, paidAt)
        val paid = order.copy(
            status = PaymentOrderStatus.PAID,
            providerTransactionId = notification.providerTransactionId,
            paidAt = paidAt
        )
        PaymentSettlementResult(PaymentSettlementOutcome.PAID_NOW, paid)
    }

    private suspend fun grantGiftIfAbsent(
        connection: Connection,
        order: PaymentOrder,
        entryId: String,
        now: Instant
    ) {
        val businessKey = "payment:${order.id}:gift"
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallets(account_id, gift_cents, cash_cents, updated_at)
                VALUES ($1, 0, 0, $2)
                ON CONFLICT (account_id) DO NOTHING
                """.trimIndent()
            ).bind(0, UUID.fromString(order.accountId)).bind(1, now)
        )
        val existingLedger = queryOne(
            connection.createStatement("SELECT 1 FROM commercial_wallet_ledger WHERE business_key = $1")
                .bind(0, businessKey)
        ) { _, _ -> true } ?: false
        if (existingLedger) return
        val balances = queryOne(
            connection.createStatement("SELECT gift_cents, cash_cents FROM commercial_wallets WHERE account_id = $1 FOR UPDATE")
                .bind(0, UUID.fromString(order.accountId))
        ) { row, _ ->
            row.get("gift_cents", java.lang.Long::class.java)!!.toLong() to
                row.get("cash_cents", java.lang.Long::class.java)!!.toLong()
        } ?: error("wallet row was not created")
        val newGiftBalance = Math.addExact(balances.first, order.giftCents)
        executeFully(
            connection.createStatement(
                "UPDATE commercial_wallets SET gift_cents = $2, updated_at = $3 WHERE account_id = $1"
            ).bind(0, UUID.fromString(order.accountId)).bind(1, newGiftBalance).bind(2, now)
        )
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_wallet_ledger(
                    entry_id, account_id, operation_type, business_key, gift_delta_cents, cash_delta_cents,
                    gift_balance_cents, cash_balance_cents, description, created_at
                ) VALUES ($1, $2, 'CREDIT_GIFT', $3, $4, 0, $5, $6, $7, $8)
                """.trimIndent()
            )
                .bind(0, UUID.fromString(entryId))
                .bind(1, UUID.fromString(order.accountId))
                .bind(2, businessKey)
                .bind(3, order.giftCents)
                .bind(4, newGiftBalance)
                .bind(5, balances.second)
                .bind(6, "Payment gift for ${order.productId.name}")
                .bind(7, now)
        )
    }

    private suspend fun advisoryLock(connection: Connection, key: String) {
        queryOne(
            connection.createStatement("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))").bind(0, key)
        ) { _, _ -> true }
    }
}

private fun Row.toPaymentOrder(): PaymentOrder = PaymentOrder(
    id = get("order_id", UUID::class.java)!!.toString(),
    merchantOrderNo = get("merchant_order_no", String::class.java)!!,
    requestKey = get("request_key", String::class.java)!!,
    accountId = get("account_id", UUID::class.java)!!.toString(),
    productId = ProductId.valueOf(get("product_id", String::class.java)!!),
    provider = PaymentProviderType.valueOf(get("provider", String::class.java)!!),
    amountCents = get("amount_cents", java.lang.Long::class.java)!!.toLong(),
    giftCents = get("gift_cents", java.lang.Long::class.java)!!.toLong(),
    status = PaymentOrderStatus.valueOf(get("status", String::class.java)!!),
    providerTransactionId = get("provider_transaction_id", String::class.java),
    createdAt = get("created_at", Instant::class.java)!!,
    paidAt = get("paid_at", Instant::class.java)
)
