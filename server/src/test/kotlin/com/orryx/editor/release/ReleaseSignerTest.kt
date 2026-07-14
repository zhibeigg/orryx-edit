package com.orryx.editor.release

import java.security.KeyPairGenerator
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReleaseSignerTest {
    @Test
    fun `jdk21 ed25519 signs verifies and uses base64url without padding`() {
        val pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val privateBytes = pair.private.encoded.copyOf()
        val publicBytes = pair.public.encoded.copyOf()
        val signer = try {
            Ed25519ReleaseSigner.fromPkcs8AndX509(privateBytes, publicBytes)
        } finally {
            privateBytes.fill(0)
        }
        val payload = "orryx-release-payload".toByteArray()

        val signature = signer.sign(payload)

        assertFalse('=' in signature)
        assertEquals(64, Base64.getUrlDecoder().decode(signature).size)
        assertTrue(signer.verify(payload, signature))
        assertTrue(Ed25519ReleaseSigner.verify(publicBytes, payload, signature))
        assertFalse(signer.verify("tampered".toByteArray(), signature))
        assertEquals(64, signer.keyId.length)
    }
}
