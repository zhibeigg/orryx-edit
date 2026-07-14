package com.orryx.editor.payment

import com.orryx.editor.entitlement.Entitlement
import com.orryx.editor.entitlement.EntitlementSourceType
import com.orryx.editor.entitlement.EntitlementType
import com.orryx.editor.wallet.WalletLedgerEntry
import com.orryx.editor.wallet.WalletOperationType
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

class InMemoryPaymentSettlementStore : PaymentSettlementStore {
    private val mutex = Mutex()
    private val ordersByMerchantNo = mutableMapOf<String, PaymentOrder>()
    private val merchantNoByRequestKey = mutableMapOf<String, String>()
    private val merchantNoByProviderTransaction = mutableMapOf<String, String>()
    private val entitlements = mutableMapOf<Pair<String, EntitlementType>, Entitlement>()
    private val giftBalances = mutableMapOf<String, Long>()
    private val giftLedger = mutableMapOf<String, WalletLedgerEntry>()

    override suspend fun createOrder(order: PaymentOrder): PaymentOrderCreateResult = mutex.withLock {
        val existing = merchantNoByRequestKey[order.requestKey]?.let(ordersByMerchantNo::get)
        if (existing != null) {
            val sameRequest = existing.accountId == order.accountId &&
                existing.productId == order.productId &&
                existing.provider == order.provider
            return@withLock PaymentOrderCreateResult(
                if (sameRequest) PaymentOrderCreateOutcome.IDEMPOTENT_REPLAY
                else PaymentOrderCreateOutcome.IDEMPOTENCY_KEY_CONFLICT,
                existing
            )
        }
        ordersByMerchantNo.values.firstOrNull {
            it.accountId == order.accountId && it.productId == order.productId &&
                it.provider == order.provider && it.status == PaymentOrderStatus.PENDING
        }?.let { active ->
            return@withLock PaymentOrderCreateResult(PaymentOrderCreateOutcome.ACTIVE_ORDER_EXISTS, active)
        }
        check(order.merchantOrderNo !in ordersByMerchantNo) { "duplicate merchant order number" }
        ordersByMerchantNo[order.merchantOrderNo] = order
        merchantNoByRequestKey[order.requestKey] = order.merchantOrderNo
        PaymentOrderCreateResult(PaymentOrderCreateOutcome.CREATED, order)
    }

    override suspend fun findByMerchantOrderNo(merchantOrderNo: String): PaymentOrder? = mutex.withLock {
        ordersByMerchantNo[merchantOrderNo]
    }

    override suspend fun listOrders(
        accountId: String?,
        status: PaymentOrderStatus?,
        limit: Int
    ): List<PaymentOrder> = mutex.withLock {
        require(limit in 1..100) { "limit 必须在 1..100 范围内" }
        ordersByMerchantNo.values.asSequence()
            .filter { accountId == null || it.accountId == accountId }
            .filter { status == null || it.status == status }
            .sortedWith(compareByDescending<PaymentOrder> { it.createdAt }.thenByDescending { it.id })
            .take(limit)
            .toList()
    }

    override suspend fun settlePaid(
        notification: ValidatedPaymentNotification,
        paidAt: Instant,
        entitlementId: String,
        giftLedgerEntryId: String
    ): PaymentSettlementResult = mutex.withLock {
        val order = ordersByMerchantNo[notification.merchantOrderNo] ?: error("payment order not found")
        if (notification.amountCents != order.amountCents) {
            return@withLock PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }
        if (order.status == PaymentOrderStatus.PAID) {
            val outcome = if (order.providerTransactionId == notification.providerTransactionId) {
                PaymentSettlementOutcome.ALREADY_PAID
            } else {
                PaymentSettlementOutcome.REJECTED
            }
            return@withLock PaymentSettlementResult(outcome, order)
        }
        if (order.status != PaymentOrderStatus.PENDING) {
            return@withLock PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }
        val transactionOwner = merchantNoByProviderTransaction[notification.providerTransactionId]
        if (transactionOwner != null && transactionOwner != order.merchantOrderNo) {
            return@withLock PaymentSettlementResult(PaymentSettlementOutcome.REJECTED, order)
        }

        val paid = order.copy(
            status = PaymentOrderStatus.PAID,
            providerTransactionId = notification.providerTransactionId,
            paidAt = paidAt
        )
        val entitlementKey = order.accountId to EntitlementType.AI_EDITOR_PERMANENT
        val entitlement = Entitlement(
            id = entitlementId,
            accountId = order.accountId,
            type = EntitlementType.AI_EDITOR_PERMANENT,
            sourceType = EntitlementSourceType.PAYMENT,
            sourceId = order.id,
            grantedAt = paidAt
        )
        val ledgerBusinessKey = giftBusinessKey(order.id)
        val giftGrant = if (ledgerBusinessKey !in giftLedger) {
            val newBalance = Math.addExact(giftBalances[order.accountId] ?: 0L, order.giftCents)
            newBalance to WalletLedgerEntry(
                id = giftLedgerEntryId,
                accountId = order.accountId,
                operationType = WalletOperationType.CREDIT_GIFT,
                businessKey = ledgerBusinessKey,
                giftDeltaCents = order.giftCents,
                cashDeltaCents = 0,
                giftBalanceCents = newBalance,
                cashBalanceCents = 0,
                description = "Payment gift for ${order.productId.name}",
                createdAt = paidAt
            )
        } else {
            null
        }

        entitlements.putIfAbsent(entitlementKey, entitlement)
        giftGrant?.let { (newBalance, entry) ->
            giftBalances[order.accountId] = newBalance
            giftLedger[ledgerBusinessKey] = entry
        }
        ordersByMerchantNo[order.merchantOrderNo] = paid
        merchantNoByProviderTransaction[notification.providerTransactionId] = order.merchantOrderNo
        PaymentSettlementResult(PaymentSettlementOutcome.PAID_NOW, paid)
    }

    suspend fun hasPermanentEntitlement(accountId: String): Boolean = mutex.withLock {
        accountId to EntitlementType.AI_EDITOR_PERMANENT in entitlements
    }

    suspend fun giftBalance(accountId: String): Long = mutex.withLock { giftBalances[accountId] ?: 0L }

    suspend fun giftGrantCount(orderId: String): Int = mutex.withLock {
        if (giftBusinessKey(orderId) in giftLedger) 1 else 0
    }

    private fun giftBusinessKey(orderId: String): String = "payment:$orderId:gift"
}
