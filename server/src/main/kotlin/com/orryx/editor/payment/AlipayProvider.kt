package com.orryx.editor.payment

import java.math.BigDecimal
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64

interface PaymentNotificationValidator {
    fun validateNotification(
        fields: Map<String, String>,
        expectation: PaymentNotificationExpectation
    ): ValidatedPaymentNotification
}

interface PaymentProvider : PaymentNotificationValidator {
    val type: PaymentProviderType
    fun createRequest(order: PaymentOrder, product: Product): SignedPaymentRequest
}

object Rsa2 {
    fun canonicalize(fields: Map<String, String>): String {
        validateFields(fields)
        return fields.asSequence()
            .filter { (key, value) -> key != "sign" && key != "sign_type" && value.isNotEmpty() }
            .sortedBy { it.key }
            .joinToString("&") { (key, value) -> "$key=$value" }
    }

    fun sign(fields: Map<String, String>, privateKey: PrivateKey): String {
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(privateKey)
        signer.update(canonicalize(fields).toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(signer.sign())
    }

    fun verify(fields: Map<String, String>, signature: String, publicKey: PublicKey): Boolean {
        if (signature.length !in 1..2048) return false
        val signatureBytes = runCatching { Base64.getDecoder().decode(signature) }.getOrNull() ?: return false
        return try {
            val verifier = Signature.getInstance("SHA256withRSA")
            verifier.initVerify(publicKey)
            verifier.update(canonicalize(fields).toByteArray(Charsets.UTF_8))
            verifier.verify(signatureBytes)
        } finally {
            signatureBytes.fill(0)
        }
    }

    fun privateKey(pemOrBase64: String): PrivateKey {
        val bytes = decodePem(pemOrBase64, "PRIVATE KEY")
        return try {
            KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(bytes))
        } finally {
            bytes.fill(0)
        }
    }

    fun publicKey(pemOrBase64: String): PublicKey {
        val bytes = decodePem(pemOrBase64, "PUBLIC KEY")
        return try {
            KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes))
        } finally {
            bytes.fill(0)
        }
    }

    private fun decodePem(value: String, label: String): ByteArray {
        require(value.length in 64..16_384) { "invalid RSA key length" }
        val normalized = value
            .replace("-----BEGIN $label-----", "")
            .replace("-----END $label-----", "")
            .filterNot(Char::isWhitespace)
        return Base64.getDecoder().decode(normalized)
    }

    private fun validateFields(fields: Map<String, String>) {
        require(fields.size in 1..64) { "invalid field count" }
        fields.forEach { (key, value) ->
            require(key.length in 1..64 && FIELD_NAME.matches(key)) { "invalid field name" }
            require(value.length <= 16_384) { "field value is too long" }
        }
    }

    private val FIELD_NAME = Regex("^[A-Za-z0-9_]+$")
}

class AlipayProvider(
    private val appId: String,
    private val sellerId: String,
    private val merchantPrivateKey: PrivateKey,
    private val alipayPublicKey: PublicKey,
    private val notifyUrl: String? = null,
    private val returnUrl: String? = null
) : PaymentProvider {
    override val type: PaymentProviderType = PaymentProviderType.ALIPAY

    init {
        require(appId.length in 8..32 && appId.all(Char::isDigit)) { "invalid Alipay appId" }
        require(sellerId.length in 8..32 && sellerId.all(Char::isDigit)) { "invalid Alipay sellerId" }
        require(notifyUrl == null || notifyUrl.length in 10..2048) { "invalid notifyUrl" }
        require(returnUrl == null || returnUrl.length in 10..2048) { "invalid returnUrl" }
    }

    override fun createRequest(order: PaymentOrder, product: Product): SignedPaymentRequest {
        require(order.provider == type)
        require(order.amountCents == product.priceCents) { "order amount does not match catalog" }
        val fields = linkedMapOf(
            "app_id" to appId,
            "method" to "alipay.trade.page.pay",
            "format" to "JSON",
            "charset" to "utf-8",
            "sign_type" to "RSA2",
            "timestamp" to TIMESTAMP_FORMATTER.format(order.createdAt.atZone(ALIPAY_ZONE)),
            "version" to "1.0",
            "biz_content" to buildBizContent(order, product)
        )
        notifyUrl?.let { fields["notify_url"] = it }
        returnUrl?.let { fields["return_url"] = it }
        fields["sign"] = Rsa2.sign(fields, merchantPrivateKey)
        return SignedPaymentRequest(type, fields)
    }

    override fun validateNotification(
        fields: Map<String, String>,
        expectation: PaymentNotificationExpectation
    ): ValidatedPaymentNotification {
        require(fields.size in 8..64) { "invalid Alipay notification field count" }
        val signType = fields.required("sign_type", 4..8)
        require(signType == "RSA2") { "unsupported Alipay sign_type" }
        val signature = fields.required("sign", 1..2048)
        require(Rsa2.verify(fields, signature, alipayPublicKey)) { "invalid Alipay signature" }
        require(fields.required("app_id", 8..32) == appId) { "Alipay app_id mismatch" }
        require(fields.required("seller_id", 8..32) == sellerId) { "Alipay seller_id mismatch" }
        val merchantOrderNo = fields.required("out_trade_no", 8..64)
        require(merchantOrderNo == expectation.merchantOrderNo) { "Alipay order number mismatch" }
        val providerTransactionId = fields.required("trade_no", 8..64)
        require(ORDER_ID.matches(merchantOrderNo) && ORDER_ID.matches(providerTransactionId)) { "invalid order identifier" }
        val tradeStatus = fields.required("trade_status", 8..32)
        require(tradeStatus == "TRADE_SUCCESS" || tradeStatus == "TRADE_FINISHED") {
            "Alipay trade is not successful"
        }
        val amountCents = parseCents(fields.required("total_amount", 1..32))
        require(amountCents == expectation.amountCents) { "Alipay amount mismatch" }
        return ValidatedPaymentNotification(merchantOrderNo, providerTransactionId, amountCents, tradeStatus)
    }

    private fun buildBizContent(order: PaymentOrder, product: Product): String =
        "{\"out_trade_no\":\"${order.merchantOrderNo}\",\"total_amount\":\"${formatCents(order.amountCents)}\"," +
            "\"subject\":\"${product.title}\",\"product_code\":\"FAST_INSTANT_TRADE_PAY\"}"

    private fun formatCents(cents: Long): String = BigDecimal.valueOf(cents, 2).toPlainString()

    private fun parseCents(value: String): Long {
        val amount = value.toBigDecimalOrNull() ?: error("invalid Alipay amount")
        require(amount.signum() >= 0 && amount.scale() <= 2) { "invalid Alipay amount scale" }
        return amount.movePointRight(2).longValueExact()
    }

    private fun Map<String, String>.required(key: String, length: IntRange): String {
        val value = this[key] ?: error("missing Alipay field: $key")
        require(value.length in length) { "invalid Alipay field length: $key" }
        return value
    }

    private companion object {
        val ALIPAY_ZONE: ZoneId = ZoneId.of("Asia/Shanghai")
        val TIMESTAMP_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        val ORDER_ID = Regex("^[A-Za-z0-9_-]+$")
    }
}
