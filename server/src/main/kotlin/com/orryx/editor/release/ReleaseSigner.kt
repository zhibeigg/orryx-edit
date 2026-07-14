package com.orryx.editor.release

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

interface ReleaseSigner {
    val keyId: String
    val publicKeyDer: ByteArray
    fun sign(payload: ByteArray): String
    fun verify(payload: ByteArray, signature: String): Boolean
}

class Ed25519ReleaseSigner private constructor(
    private val privateKey: PrivateKey,
    private val publicKey: PublicKey
) : ReleaseSigner {
    override val publicKeyDer: ByteArray
        get() = publicKey.encoded.copyOf()

    override val keyId: String = MessageDigest.getInstance("SHA-256")
        .digest(publicKey.encoded)
        .toHex()

    override fun sign(payload: ByteArray): String {
        val signer = Signature.getInstance("Ed25519")
        signer.initSign(privateKey)
        signer.update(payload)
        val signature = signer.sign()
        return try {
            Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
        } finally {
            signature.fill(0)
        }
    }

    override fun verify(payload: ByteArray, signature: String): Boolean =
        verify(publicKey.encoded, payload, signature)

    companion object {
        fun fromPkcs8AndX509(privateKeyPkcs8: ByteArray, publicKeyX509: ByteArray): Ed25519ReleaseSigner {
            val privateCopy = privateKeyPkcs8.copyOf()
            val publicCopy = publicKeyX509.copyOf()
            return try {
                val factory = KeyFactory.getInstance("Ed25519")
                Ed25519ReleaseSigner(
                    factory.generatePrivate(PKCS8EncodedKeySpec(privateCopy)),
                    factory.generatePublic(X509EncodedKeySpec(publicCopy))
                )
            } finally {
                privateCopy.fill(0)
                publicCopy.fill(0)
            }
        }

        fun verify(publicKeyX509: ByteArray, payload: ByteArray, signature: String): Boolean {
            val decoded = runCatching { Base64.getUrlDecoder().decode(signature) }.getOrNull() ?: return false
            return try {
                val publicKey = KeyFactory.getInstance("Ed25519")
                    .generatePublic(X509EncodedKeySpec(publicKeyX509.copyOf()))
                val verifier = Signature.getInstance("Ed25519")
                verifier.initVerify(publicKey)
                verifier.update(payload)
                verifier.verify(decoded)
            } finally {
                decoded.fill(0)
            }
        }
    }
}

internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
