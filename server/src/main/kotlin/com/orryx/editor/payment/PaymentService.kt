package com.orryx.editor.payment

import java.time.Clock
import java.time.Instant
import java.util.UUID

interface PaymentSettlementStore {
    suspend fun createOrder(order: PaymentOrder): PaymentOrderCreateResult
    suspend fun findByMerchantOrderNo(merchantOrderNo: String): PaymentOrder?

    /** Atomically marks the order paid, grants its entitlement and appends its gift ledger entry. */
    suspend fun settlePaid(
        notification: ValidatedPaymentNotification,
        paidAt: Instant,
        entitlementId: String,
        giftLedgerEntryId: String
    ): PaymentSettlementResult
}

class PaymentService(
    private val store: PaymentSettlementStore,
    providers: Collection<PaymentProvider>,
    private val productCatalog: ProductCatalog = BuiltInProductCatalog,
    private val clock: Clock = Clock.systemUTC(),
    private val orderIdGenerator: () -> String = { UUID.randomUUID().toString() },
    private val merchantOrderNoGenerator: () -> String = {
        "ORYX${UUID.randomUUID().toString().replace("-", "").uppercase()}"
    },
    private val entitlementIdGenerator: () -> String = { UUID.randomUUID().toString() },
    private val giftLedgerEntryIdGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    private val providers = providers.associateBy(PaymentProvider::type)

    init {
        require(this.providers.isNotEmpty()) { "at least one payment provider is required" }
        require(this.providers.size == providers.size) { "duplicate payment provider type" }
    }

    suspend fun create(command: CreatePaymentCommand): CreatedPayment {
        val provider = providers[command.provider] ?: error("payment provider is not configured")
        val product = productCatalog.get(command.productId) ?: error("product is not available")
        val order = PaymentOrder(
            id = UUID.fromString(orderIdGenerator()).toString(),
            merchantOrderNo = validateMerchantOrderNo(merchantOrderNoGenerator()),
            requestKey = command.requestKey,
            accountId = UUID.fromString(command.accountId).toString(),
            productId = product.id,
            provider = provider.type,
            amountCents = product.priceCents,
            giftCents = product.giftCents,
            status = PaymentOrderStatus.PENDING,
            createdAt = clock.instant()
        )
        val created = store.createOrder(order)
        check(created.outcome != PaymentOrderCreateOutcome.IDEMPOTENCY_KEY_CONFLICT) {
            "payment requestKey was already used for a different order"
        }
        val persistedProduct = productCatalog.get(created.order.productId) ?: error("product is not available")
        check(created.order.amountCents == persistedProduct.priceCents) { "persisted order amount differs from catalog" }
        return CreatedPayment(created.order, provider.createRequest(created.order, persistedProduct))
    }

    suspend fun handleNotification(
        providerType: PaymentProviderType,
        fields: Map<String, String>
    ): PaymentSettlementResult {
        val merchantOrderNo = fields["out_trade_no"]?.let(::validateMerchantOrderNo)
            ?: error("missing payment order number")
        val order = store.findByMerchantOrderNo(merchantOrderNo) ?: error("payment order not found")
        require(order.provider == providerType) { "payment provider mismatch" }
        val provider = providers[providerType] ?: error("payment provider is not configured")
        val notification = provider.validateNotification(
            fields,
            PaymentNotificationExpectation(order.merchantOrderNo, order.amountCents)
        )
        return store.settlePaid(
            notification = notification,
            paidAt = clock.instant(),
            entitlementId = UUID.fromString(entitlementIdGenerator()).toString(),
            giftLedgerEntryId = UUID.fromString(giftLedgerEntryIdGenerator()).toString()
        )
    }

    private fun validateMerchantOrderNo(value: String): String {
        require(value.length in 8..64 && MERCHANT_ORDER.matches(value)) { "invalid merchant order number" }
        return value
    }

    private companion object {
        val MERCHANT_ORDER = Regex("^[A-Za-z0-9_-]+$")
    }
}
