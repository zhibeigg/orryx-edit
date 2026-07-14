package com.orryx.editor.payment

import com.orryx.editor.auth.InstantIsoSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable
enum class PaymentProviderType {
    ALIPAY
}

@Serializable
enum class ProductId {
    AI_PERMANENT_99
}

@Serializable
data class Product(
    val id: ProductId,
    val title: String,
    val priceCents: Long,
    val permanentAiEditor: Boolean,
    val giftCents: Long
) {
    init {
        require(title.length in 1..120)
        require(priceCents in 1..10_000_000_00L)
        require(giftCents in 0..10_000_000_00L)
    }
}

interface ProductCatalog {
    fun get(productId: ProductId): Product?
}

object BuiltInProductCatalog : ProductCatalog {
    val AI_PERMANENT_99 = Product(
        id = ProductId.AI_PERMANENT_99,
        title = "Orryx AI Editor Permanent",
        priceCents = 9_900,
        permanentAiEditor = true,
        giftCents = 5_000
    )

    override fun get(productId: ProductId): Product? = when (productId) {
        ProductId.AI_PERMANENT_99 -> AI_PERMANENT_99
    }
}

@Serializable
enum class PaymentOrderStatus {
    PENDING,
    PAID,
    CLOSED
}

@Serializable
data class PaymentOrder(
    val id: String,
    val merchantOrderNo: String,
    val requestKey: String,
    val accountId: String,
    val productId: ProductId,
    val provider: PaymentProviderType,
    val amountCents: Long,
    val giftCents: Long,
    val status: PaymentOrderStatus,
    val providerTransactionId: String? = null,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val paidAt: Instant? = null
)

@Serializable
data class CreatePaymentCommand(
    val accountId: String,
    val productId: ProductId,
    val provider: PaymentProviderType = PaymentProviderType.ALIPAY,
    val requestKey: String
) {
    init {
        require(requestKey.length in 8..128 && REQUEST_KEY.matches(requestKey)) { "invalid requestKey" }
    }

    private companion object {
        val REQUEST_KEY = Regex("^[A-Za-z0-9._:-]+$")
    }
}

@Serializable
data class SignedPaymentRequest(
    val provider: PaymentProviderType,
    val fields: Map<String, String>
)

@Serializable
data class CreatedPayment(
    val order: PaymentOrder,
    val request: SignedPaymentRequest
)

@Serializable
data class PaymentNotificationExpectation(
    val merchantOrderNo: String,
    val amountCents: Long
)

@Serializable
data class ValidatedPaymentNotification(
    val merchantOrderNo: String,
    val providerTransactionId: String,
    val amountCents: Long,
    val tradeStatus: String
)

@Serializable
enum class PaymentSettlementOutcome {
    PAID_NOW,
    ALREADY_PAID,
    REJECTED
}

@Serializable
data class PaymentSettlementResult(
    val outcome: PaymentSettlementOutcome,
    val order: PaymentOrder
)

@Serializable
enum class PaymentOrderCreateOutcome {
    CREATED,
    IDEMPOTENT_REPLAY,
    ACTIVE_ORDER_EXISTS,
    IDEMPOTENCY_KEY_CONFLICT
}

@Serializable
data class PaymentOrderCreateResult(
    val outcome: PaymentOrderCreateOutcome,
    val order: PaymentOrder
)
