package com.orryx.editor.security

import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.ceil

private const val MIN_ADMIN_KEY_LENGTH = 16

fun requireSecureAdminKey(rawKey: String?): String {
    val key = rawKey?.trim().orEmpty()
    require(key.isNotEmpty()) { "ADMIN_KEY 必须显式配置" }
    require(!constantTimeEquals(key, "change-me")) { "ADMIN_KEY 不能使用默认值 change-me" }
    require(key.length >= MIN_ADMIN_KEY_LENGTH) { "ADMIN_KEY trim 后长度至少为 $MIN_ADMIN_KEY_LENGTH" }
    return key
}

fun constantTimeEquals(actual: String, expected: String): Boolean {
    return MessageDigest.isEqual(actual.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))
}

data class CorsOrigin(val scheme: String, val host: String, val port: Int?) {
    val ktorHost: String
        get() {
            val renderedHost = if (host.contains(':')) "[$host]" else host
            return port?.let { "$renderedHost:$it" } ?: renderedHost
        }
}

fun parseCorsOrigins(rawHosts: String?): List<CorsOrigin> {
    if (rawHosts.isNullOrBlank()) return emptyList()
    return rawHosts.split(',').map { value ->
        val candidate = value.trim()
        require(candidate.isNotEmpty()) { "CORS_HOSTS 包含空条目" }
        val uri = runCatching { URI(candidate) }
            .getOrElse { throw IllegalArgumentException("CORS_HOSTS 包含无效 origin: $candidate") }
        val scheme = uri.scheme?.lowercase()
        require(scheme == "http" || scheme == "https") { "CORS origin 仅支持 http/https: $candidate" }
        require(uri.host != null && uri.rawUserInfo == null) { "CORS origin 必须包含合法 host: $candidate" }
        require(uri.rawPath.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null) {
            "CORS origin 不允许 path/query/fragment: $candidate"
        }
        require(uri.port in -1..65535) { "CORS origin 端口无效: $candidate" }
        CorsOrigin(scheme, uri.host.lowercase(), uri.port.takeIf { it >= 0 })
    }.distinct()
}

data class SecuritySettings(
    val corsOrigins: List<CorsOrigin> = emptyList(),
    val trustedProxies: TrustedProxySet = TrustedProxySet.EMPTY,
    val hstsEnabled: Boolean = false
)

fun loadSecuritySettings(environment: Map<String, String>): SecuritySettings {
    return SecuritySettings(
        corsOrigins = parseCorsOrigins(environment["CORS_HOSTS"]),
        trustedProxies = TrustedProxySet.parse(environment["TRUSTED_PROXY_IPS"]),
        hstsEnabled = environment["HSTS_ENABLED"]?.trim()?.equals("true", ignoreCase = true) == true
    )
}

class TrustedProxySet private constructor(private val networks: List<IpNetwork>) {
    fun contains(address: String): Boolean {
        val parsed = IpAddress.parse(address) ?: return false
        return networks.any { it.contains(parsed) }
    }

    companion object {
        val EMPTY = TrustedProxySet(emptyList())

        fun parse(raw: String?): TrustedProxySet {
            if (raw.isNullOrBlank()) return EMPTY
            val networks = raw.split(',').map { entry ->
                val candidate = entry.trim()
                require(candidate.isNotEmpty()) { "TRUSTED_PROXY_IPS 包含空条目" }
                IpNetwork.parse(candidate)
                    ?: throw IllegalArgumentException("TRUSTED_PROXY_IPS 包含无效 IP/CIDR: $candidate")
            }
            return TrustedProxySet(networks)
        }
    }
}

fun normalizeIpAddress(rawAddress: String): String? = IpAddress.parse(rawAddress)?.normalized

fun resolveClientIp(
    remoteAddress: String,
    forwardedHeader: String?,
    xForwardedForHeader: String?,
    trustedProxies: TrustedProxySet
): String {
    val remote = IpAddress.parse(remoteAddress) ?: return remoteAddress.take(128)
    if (!trustedProxies.contains(remote.normalized)) return remote.normalized

    val forwardedChain = parseForwarded(forwardedHeader)
    val xForwardedChain = parseXForwardedFor(xForwardedForHeader)
    val chain = forwardedChain ?: xForwardedChain ?: return remote.normalized

    var current = remote.normalized
    for (hop in chain.asReversed()) {
        if (!trustedProxies.contains(current)) break
        current = hop
    }
    return current
}

private fun parseForwarded(header: String?): List<String>? {
    if (header.isNullOrBlank()) return null
    val result = header.split(',').map { element ->
        val forValue = element.split(';')
            .map { it.trim() }
            .firstOrNull { it.startsWith("for=", ignoreCase = true) }
            ?.substringAfter('=')
            ?.trim()
            ?.removeSurrounding("\"")
            ?: return null
        parseForwardedAddress(forValue) ?: return null
    }
    return result.takeIf { it.isNotEmpty() }
}

private fun parseXForwardedFor(header: String?): List<String>? {
    if (header.isNullOrBlank()) return null
    val result = header.split(',').map { value ->
        IpAddress.parse(value.trim())?.normalized ?: return null
    }
    return result.takeIf { it.isNotEmpty() }
}

private fun parseForwardedAddress(value: String): String? {
    if (value.equals("unknown", ignoreCase = true) || value.startsWith('_')) return null
    val address = when {
        value.startsWith('[') -> value.substringAfter('[').substringBefore(']').takeIf { value.contains(']') }
        value.count { it == ':' } == 1 && value.substringBeforeLast(':').contains('.') -> value.substringBeforeLast(':')
        else -> value
    } ?: return null
    return IpAddress.parse(address)?.normalized
}

private data class IpAddress(val bytes: ByteArray, val normalized: String) {
    companion object {
        fun parse(raw: String): IpAddress? {
            val value = raw.trim().removePrefix("[").removeSuffix("]")
            if (value.isEmpty() || value.contains('%')) return null
            val bytes = if (value.contains(':')) parseIpv6(value) else parseIpv4(value)
            return bytes?.let { IpAddress(it, normalize(it)) }
        }

        private fun parseIpv4(value: String): ByteArray? {
            val parts = value.split('.')
            if (parts.size != 4) return null
            return ByteArray(4) { index ->
                val part = parts[index]
                if (part.isEmpty() || part.length > 3 || part.any { !it.isDigit() }) return null
                val number = part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
                number.toByte()
            }
        }

        private fun parseIpv6(value: String): ByteArray? {
            if (value.any { it !in "0123456789abcdefABCDEF:." }) return null
            val address = runCatching { InetAddress.getByName(value) }.getOrNull()
            return (address as? Inet6Address)?.address
        }

        private fun normalize(bytes: ByteArray): String {
            return InetAddress.getByAddress(bytes).hostAddress.substringBefore('%')
        }
    }
}

private data class IpNetwork(val bytes: ByteArray, val prefixLength: Int) {
    fun contains(address: IpAddress): Boolean {
        if (bytes.size != address.bytes.size) return false
        val fullBytes = prefixLength / 8
        val remainingBits = prefixLength % 8
        for (index in 0 until fullBytes) {
            if (bytes[index] != address.bytes[index]) return false
        }
        if (remainingBits == 0) return true
        val mask = (0xff shl (8 - remainingBits)) and 0xff
        return (bytes[fullBytes].toInt() and mask) == (address.bytes[fullBytes].toInt() and mask)
    }

    companion object {
        fun parse(value: String): IpNetwork? {
            val parts = value.split('/', limit = 2)
            val address = IpAddress.parse(parts[0]) ?: return null
            val maxPrefix = address.bytes.size * 8
            val prefix = if (parts.size == 2) parts[1].toIntOrNull() else maxPrefix
            if (prefix == null || prefix !in 0..maxPrefix) return null
            return IpNetwork(address.bytes, prefix)
        }
    }
}

data class RateLimitDecision(val allowed: Boolean, val retryAfterSeconds: Long = 0)

class IpRateLimiter(
    private val limit: Int = 20,
    private val windowMillis: Long = 60_000,
    private val staleAfterMillis: Long = 10 * 60_000,
    private val maxEntries: Int = 10_000,
    private val clock: () -> Long = System::currentTimeMillis
) {
    private data class Bucket(val windowStartedAt: Long, val count: Int, val lastSeenAt: Long)

    private val buckets = ConcurrentHashMap<String, Bucket>()
    private val operations = AtomicLong()

    init {
        require(limit > 0)
        require(windowMillis > 0)
        require(staleAfterMillis >= windowMillis)
        require(maxEntries > 0)
    }

    fun check(clientIp: String): RateLimitDecision {
        val now = clock()
        if (operations.incrementAndGet() % 128L == 0L || buckets.size >= maxEntries) cleanup(now)
        if (!buckets.containsKey(clientIp) && buckets.size >= maxEntries) {
            return RateLimitDecision(false, 1)
        }

        var decision = RateLimitDecision(true)
        buckets.compute(clientIp) { _, current ->
            val bucket = if (current == null || now - current.windowStartedAt >= windowMillis) {
                Bucket(now, 1, now)
            } else {
                val nextCount = current.count + 1
                if (nextCount > limit) {
                    val remaining = (current.windowStartedAt + windowMillis - now).coerceAtLeast(1)
                    decision = RateLimitDecision(false, ceil(remaining / 1000.0).toLong())
                }
                current.copy(count = nextCount, lastSeenAt = now)
            }
            bucket
        }
        return decision
    }

    fun cleanup(now: Long = clock()): Int {
        val before = buckets.size
        buckets.entries.removeIf { now - it.value.lastSeenAt >= staleAfterMillis }
        return before - buckets.size
    }

    internal fun size(): Int = buckets.size
}
