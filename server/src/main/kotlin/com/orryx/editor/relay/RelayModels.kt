package com.orryx.editor.relay

import com.orryx.editor.license.LicenseEntry
import com.orryx.editor.license.LicenseManager
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.send
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

interface RelaySocket {
    suspend fun sendText(text: String)
}

internal class KtorRelaySocket(val session: WebSocketSession) : RelaySocket {
    override suspend fun sendText(text: String) {
        session.send(text)
    }
}

data class RelayLicense(
    val license: String,
    val serverKey: String,
    val enabled: Boolean,
    val expiresAt: Long,
    val boundIps: List<String>
) {
    fun isExpired(now: Long = System.currentTimeMillis()): Boolean = expiresAt > 0 && now > expiresAt
    fun isIpAllowed(ip: String): Boolean = boundIps.isEmpty() || ip.isEmpty() || ip in boundIps
}

interface RelayLicenseAccess {
    suspend fun validate(license: String, connectIp: String): RelayLicense?
    suspend fun get(license: String): RelayLicense?
    suspend fun addIp(license: String, ip: String): Boolean
}

class LicenseManagerRelayAccess(private val manager: LicenseManager) : RelayLicenseAccess {
    override suspend fun validate(license: String, connectIp: String): RelayLicense? =
        manager.validate(license, connectIp)?.toRelayLicense()

    override suspend fun get(license: String): RelayLicense? = manager.get(license)?.toRelayLicense()

    override suspend fun addIp(license: String, ip: String): Boolean = manager.addIp(license, ip)

    private fun LicenseEntry.toRelayLicense(): RelayLicense = RelayLicense(
        license = license,
        serverKey = serverKey,
        enabled = enabled,
        expiresAt = expiresAt,
        boundIps = boundIps
    )
}

data class EditorSessionRecord(
    val licenseKey: String,
    val browserId: String,
    val playerName: String,
    val workspaceId: String,
    val serverKey: String,
    val serverId: String,
    val expiresAt: Long
)

/**
 * 持久层只接收 token hash，绝不能持久化调用方拿到的原始 resume token。
 * consume 必须由数据库适配器实现为原子读取并删除，以便每次恢复后轮换 token。
 */
interface EditorSessionStore {
    suspend fun save(tokenHash: String, session: EditorSessionRecord)
    suspend fun consume(tokenHash: String): EditorSessionRecord?
    suspend fun revoke(tokenHash: String)
}

class InMemoryEditorSessionStore : EditorSessionStore {
    private val sessions = ConcurrentHashMap<String, EditorSessionRecord>()

    override suspend fun save(tokenHash: String, session: EditorSessionRecord) {
        sessions[tokenHash] = session
    }

    override suspend fun consume(tokenHash: String): EditorSessionRecord? {
        var consumed: EditorSessionRecord? = null
        sessions.compute(tokenHash) { _, current ->
            consumed = current
            null
        }
        return consumed
    }

    override suspend fun revoke(tokenHash: String) {
        sessions.remove(tokenHash)
    }
}

internal object RelaySecrets {
    private val random = SecureRandom()

    fun newToken(byteCount: Int = 32): String {
        val bytes = ByteArray(byteCount)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun sha256(value: String): String = sha256(value.toByteArray(Charsets.UTF_8))

    fun workspaceId(serverKey: String, serverId: String): String =
        sha256(serverKey.toByteArray(Charsets.UTF_8) + byteArrayOf(0) + serverId.toByteArray(Charsets.UTF_8))

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
