package com.orryx.editor.payment

import kotlinx.coroutines.test.runTest
import java.security.KeyPairGenerator
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PaymentServiceTest {
    private val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val appId = "2025000000000001"
    private val sellerId = "2088000000000001"

    @Test
    fun `successful callback settles order entitlement and gift exactly once`() = runTest {
        val store = InMemoryPaymentSettlementStore()
        val provider = AlipayProvider(appId, sellerId, keyPair.private, keyPair.public)
        val service = PaymentService(
            store = store,
            providers = listOf(provider),
            clock = Clock.fixed(Instant.parse("2025-01-01T00:00:00Z"), ZoneOffset.UTC),
            orderIdGenerator = { "50000000-0000-0000-0000-000000000001" },
            merchantOrderNoGenerator = { "ORYX0001" },
            entitlementIdGenerator = { "60000000-0000-0000-0000-000000000001" },
            giftLedgerEntryIdGenerator = { "70000000-0000-0000-0000-000000000001" }
        )
        val accountId = "10000000-0000-0000-0000-000000000001"
        val created = service.create(
            CreatePaymentCommand(accountId, ProductId.AI_PERMANENT_99, requestKey = "request:0001")
        )
        assertEquals(9_900, created.order.amountCents)
        assertTrue(Rsa2.verify(created.request.fields, created.request.fields.getValue("sign"), keyPair.public))
        val callback = signedCallback(created.order.merchantOrderNo)

        val first = service.handleNotification(PaymentProviderType.ALIPAY, callback)
        val replay = service.handleNotification(PaymentProviderType.ALIPAY, callback)

        assertEquals(PaymentSettlementOutcome.PAID_NOW, first.outcome)
        assertEquals(PaymentSettlementOutcome.ALREADY_PAID, replay.outcome)
        assertTrue(store.hasPermanentEntitlement(accountId))
        assertEquals(5_000, store.giftBalance(accountId))
        assertEquals(1, store.giftGrantCount(created.order.id))
        assertEquals(listOf(created.order.id), service.listOrders(accountId, PaymentOrderStatus.PAID).map(PaymentOrder::id))
    }

    @Test
    fun `one account reuses its active permanent product order`() = runTest {
        val store = InMemoryPaymentSettlementStore()
        var sequence = 0
        val service = PaymentService(
            store = store,
            providers = listOf(AlipayProvider(appId, sellerId, keyPair.private, keyPair.public)),
            orderIdGenerator = { "50000000-0000-0000-0000-${(++sequence).toString().padStart(12, '0')}" },
            merchantOrderNoGenerator = { "ORYXACTIVE${sequence + 1}" }
        )
        val accountId = "10000000-0000-0000-0000-000000000001"

        val first = service.create(CreatePaymentCommand(accountId, ProductId.AI_PERMANENT_99, requestKey = "request:active:1"))
        val second = service.create(CreatePaymentCommand(accountId, ProductId.AI_PERMANENT_99, requestKey = "request:active:2"))

        assertEquals(first.order.id, second.order.id)
        assertEquals(first.order.merchantOrderNo, second.order.merchantOrderNo)
    }

    @Test
    fun `rsa2 canonicalization signs and rejects tampering`() {
        val fields = linkedMapOf(
            "b" to "second",
            "sign_type" to "RSA2",
            "a" to "first",
            "empty" to ""
        )
        val signature = Rsa2.sign(fields, keyPair.private)

        assertEquals("a=first&b=second", Rsa2.canonicalize(fields))
        assertTrue(Rsa2.verify(fields, signature, keyPair.public))
        assertFalse(Rsa2.verify(fields + ("a" to "tampered"), signature, keyPair.public))
    }

    private fun signedCallback(merchantOrderNo: String): Map<String, String> {
        val fields = linkedMapOf(
            "app_id" to appId,
            "seller_id" to sellerId,
            "out_trade_no" to merchantOrderNo,
            "trade_no" to "2025010100000001",
            "trade_status" to "TRADE_SUCCESS",
            "total_amount" to "99.00",
            "sign_type" to "RSA2",
            "notify_id" to "notify-00000001"
        )
        fields["sign"] = Rsa2.sign(fields, keyPair.private)
        return fields
    }
}
