package com.orryx.editor.license

import java.time.Clock
import java.time.Instant

data class License(
    val license: String,
    val owner: String,
    val createdAt: Instant,
    val expiresAt: Instant?,
    val boundIps: List<String>,
    val serverKey: String,
    val enabled: Boolean,
    val maxBoundIps: Int,
    val updatedAt: Instant
) {
    fun isExpired(clock: Clock = Clock.systemUTC()): Boolean = expiresAt?.let { !it.isAfter(clock.instant()) } ?: false
    fun isIpAllowed(ip: String): Boolean = boundIps.isEmpty() || ip.isEmpty() || ip in boundIps
}

enum class AddIpResult {
    ADDED,
    ALREADY_BOUND,
    LICENSE_NOT_FOUND,
    LIMIT_REACHED
}

data class CreateLicenseCommand(
    val owner: String,
    val days: Int = 0,
    val maxBoundIps: Int = 1
)
