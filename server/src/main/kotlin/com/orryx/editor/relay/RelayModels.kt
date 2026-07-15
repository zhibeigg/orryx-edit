package com.orryx.editor.relay

import com.orryx.editor.license.LicenseEntry
import com.orryx.editor.license.LicenseManager
import com.orryx.editor.protocol.ProtocolVersion
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.send
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

interface RelaySocket {
    suspend fun sendText(text: String)
}

data class RelayFeatureFlags(
    val protocolV2Enabled: Boolean = false,
    val v2WritesEnabled: Boolean = false,
    val releaseTransactionsEnabled: Boolean = false,
) {
    init {
        require(!v2WritesEnabled || protocolV2Enabled) { "启用 V2 写路径前必须先启用协议 V2" }
        require(!releaseTransactionsEnabled || protocolV2Enabled) { "启用发布事务前必须先启用协议 V2" }
        require(!releaseTransactionsEnabled || v2WritesEnabled) { "启用发布事务前必须启用 V2 写路径" }
    }
}

object RelayCapabilities {
    const val REVISION_SHA256 = "revision.sha256"
    const val FILE_WRITE_V2 = "file.write.v2"
    const val RELEASE_CONTROL_V1 = "release.control.v1"
}

object V2EditorPluginCapabilities {
    val required: Set<String> = setOf(
        RelayCapabilities.REVISION_SHA256,
        RelayCapabilities.FILE_WRITE_V2,
        "mutation.preconditions"
    )
}

object ReleaseRelayCapabilities {
    const val CONTROL = RelayCapabilities.RELEASE_CONTROL_V1
    val requiredPlugin: Set<String> = setOf(
        "release.transaction.v1",
        "release.signature.ed25519",
        "release.readiness.async",
        "release.recovery.v1",
        "release.http-pull.v1"
    )
}

internal object PluginRelayErrorContract {
    const val FALLBACK_CODE = "PLUGIN_ERROR"
    val forwardedFields = setOf("code", "path", "currentRevision", "requestType")
    val safeCodes = setOf(
        "REQUEST_FAILED",
        "INVALID_MESSAGE",
        "INVALID_DATA",
        "MESSAGE_DIRECTION_NOT_ALLOWED",
        "UNKNOWN_MESSAGE_TYPE",
        "NOT_REGISTERED",
        "MESSAGE_NOT_SUPPORTED",
        "UNHANDLED_MESSAGE_TYPE",
        "RELAY_CAPABILITY_MISSING",
        "FILE_POLICY_VIOLATION",
        "REVISION_CONFLICT",
        "PRECONDITION_FAILED",
        "CASE_CONFLICT",
        "MUTATION_GATE_ACTIVE",
        "REQUEST_QUEUE_FULL",
        "REVISION_FIELDS_MISMATCH",
        "REVISION_REQUIRED",
        "FILE_NOT_FOUND",
        "FILE_ALREADY_EXISTS",
        "PATH_TYPE_MISMATCH",
        "PERMISSION_DENIED",
        "READ_ONLY",
        "UNSUPPORTED_OPERATION",
        "FILE_TOO_LARGE",
        "INVALID_PATH",
        "INVALID_REVISION",
        "RELOAD_FAILED",
        "MANIFEST_UNAVAILABLE",
        "READINESS_FAILED",
        "ROLLBACK_FAILED",
        "ROLLBACK_RELOAD_FAILED",
        "ROLLBACK_MANIFEST_MISMATCH",
        "RECOVERY_AMBIGUOUS",
        "INVALID_JOURNAL",
        "RECOVERY_SCAN_FAILED",
        "RELEASE_REQUEST_FAILED",
    )
}

internal fun relayCapabilities(protocolVersion: ProtocolVersion, features: RelayFeatureFlags): JsonArray {
    val capabilities = mutableListOf(
        "protocol.allowlist",
        "session.epoch",
    )
    if (protocolVersion == ProtocolVersion.V2 && features.v2WritesEnabled) {
        capabilities += RelayCapabilities.REVISION_SHA256
        capabilities += RelayCapabilities.FILE_WRITE_V2
    }
    if (protocolVersion == ProtocolVersion.V2 && features.releaseTransactionsEnabled) {
        capabilities += RelayCapabilities.RELEASE_CONTROL_V1
    }
    return JsonArray(capabilities.map(::JsonPrimitive))
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
    val boundIps: List<String>
) {
    fun isIpAllowed(ip: String): Boolean = boundIps.isEmpty() || ip.isEmpty() || ip in boundIps
}

interface RelayLicenseAccess {
    suspend fun validateEditorAccess(license: String, connectIp: String): RelayLicense?
    suspend fun get(license: String): RelayLicense?
    suspend fun addIp(license: String, ip: String): Boolean
}

class LicenseManagerRelayAccess(private val manager: LicenseManager) : RelayLicenseAccess {
    override suspend fun validateEditorAccess(license: String, connectIp: String): RelayLicense? =
        manager.validateEditorAccess(license, connectIp)?.toRelayLicense()

    override suspend fun get(license: String): RelayLicense? = manager.get(license)?.toRelayLicense()

    override suspend fun addIp(license: String, ip: String): Boolean = manager.addIp(license, ip)

    private fun LicenseEntry.toRelayLicense(): RelayLicense = RelayLicense(
        license = license,
        serverKey = serverKey,
        enabled = enabled,
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
 * lookup 只读会话，consume 必须由数据库适配器实现为原子读取并删除，以便校验通过后单次消费并轮换 token。
 */
interface EditorSessionStore {
    suspend fun save(tokenHash: String, session: EditorSessionRecord)
    suspend fun lookup(tokenHash: String): EditorSessionRecord?
    suspend fun consume(tokenHash: String): EditorSessionRecord?
    suspend fun revoke(tokenHash: String)
}

class InMemoryEditorSessionStore : EditorSessionStore {
    private val sessions = ConcurrentHashMap<String, EditorSessionRecord>()

    override suspend fun save(tokenHash: String, session: EditorSessionRecord) {
        sessions[tokenHash] = session
    }

    override suspend fun lookup(tokenHash: String): EditorSessionRecord? = sessions[tokenHash]

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
