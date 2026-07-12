package com.orryx.editor.security

import com.orryx.editor.loadServerConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SecurityTest {
    @Test
    fun `weak admin keys are rejected`() {
        assertFailsWith<IllegalArgumentException> { loadServerConfig(emptyMap()) }
        assertFailsWith<IllegalArgumentException> { loadServerConfig(mapOf("ADMIN_KEY" to "change-me")) }
        assertFailsWith<IllegalArgumentException> { loadServerConfig(mapOf("ADMIN_KEY" to "   too-short   ")) }
        assertEquals(
            "0123456789abcdef",
            loadServerConfig(mapOf("ADMIN_KEY" to "  0123456789abcdef  ")).adminKey
        )
    }

    @Test
    fun `constant time helper compares credential bytes`() {
        assertTrue(constantTimeEquals("0123456789abcdef", "0123456789abcdef"))
        assertFalse(constantTimeEquals("0123456789abcdeg", "0123456789abcdef"))
        assertFalse(constantTimeEquals("short", "0123456789abcdef"))
    }

    @Test
    fun `untrusted peer cannot spoof forwarding headers`() {
        val trusted = TrustedProxySet.parse("10.0.0.0/8")
        val clientIp = resolveClientIp(
            remoteAddress = "198.51.100.20",
            forwardedHeader = "for=203.0.113.8",
            xForwardedForHeader = "203.0.113.9",
            trustedProxies = trusted
        )
        assertEquals("198.51.100.20", clientIp)
    }

    @Test
    fun `trusted proxy chain selects first untrusted client`() {
        val trusted = TrustedProxySet.parse("10.0.0.0/8, 192.168.1.10")
        val clientIp = resolveClientIp(
            remoteAddress = "10.0.0.2",
            forwardedHeader = null,
            xForwardedForHeader = "203.0.113.9, 192.168.1.10",
            trustedProxies = trusted
        )
        assertEquals("203.0.113.9", clientIp)
    }

    @Test
    fun `invalid forwarded chain falls back to trusted socket peer`() {
        val trusted = TrustedProxySet.parse("10.0.0.0/8")
        val clientIp = resolveClientIp(
            remoteAddress = "10.0.0.2",
            forwardedHeader = "for=not-an-ip",
            xForwardedForHeader = "also-invalid",
            trustedProxies = trusted
        )
        assertEquals("10.0.0.2", clientIp)
    }

    @Test
    fun `cors origins require strict http origin syntax`() {
        assertEquals(2, parseCorsOrigins("https://editor.example.com, http://localhost:5173").size)
        assertFailsWith<IllegalArgumentException> { parseCorsOrigins("*") }
        assertFailsWith<IllegalArgumentException> { parseCorsOrigins("https://example.com/path") }
        assertFailsWith<IllegalArgumentException> { parseCorsOrigins("https://user@example.com") }
    }
}
