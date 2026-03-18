package com.orryx.editor.license

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class LicenseEntry(
    val license: String,
    val owner: String,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long = 0L,
    val boundIps: List<String> = emptyList(),
    val serverKey: String = UUID.randomUUID().toString().replace("-", ""),
    val enabled: Boolean = true
) {
    fun isExpired(): Boolean = expiresAt > 0 && System.currentTimeMillis() > expiresAt
    fun remainingDays(): Long {
        if (expiresAt <= 0) return -1
        val remaining = expiresAt - System.currentTimeMillis()
        return if (remaining > 0) remaining / 86_400_000 else 0
    }
    fun isIpAllowed(ip: String): Boolean {
        if (boundIps.isEmpty()) return true
        if (ip.isEmpty()) return true
        return ip in boundIps
    }
}

class LicenseManager(private val dataDir: File) {

    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }
    private val licenses = ConcurrentHashMap<String, LicenseEntry>()
    private val file = File(dataDir, "licenses.json")

    init {
        dataDir.mkdirs()
        load()
    }

    private fun load() {
        if (!file.exists()) return
        try {
            val list = json.decodeFromString<List<LicenseEntry>>(file.readText())
            list.forEach { licenses[it.license] = it }
        } catch (e: Exception) {
            println("加载 licenses.json 失败: ${e.message}")
        }
    }

    private fun save() {
        try {
            file.writeText(json.encodeToString(
                kotlinx.serialization.builtins.ListSerializer(LicenseEntry.serializer()),
                licenses.values.toList()
            ))
        } catch (e: Exception) {
            println("保存 licenses.json 失败: ${e.message}")
        }
    }

    fun createLicense(owner: String, days: Int = 0): LicenseEntry {
        val license = UUID.randomUUID().toString().replace("-", "").take(20)
        val expiresAt = if (days > 0) System.currentTimeMillis() + days * 86_400_000L else 0L
        val entry = LicenseEntry(license = license, owner = owner, expiresAt = expiresAt)
        licenses[license] = entry
        save()
        return entry
    }

    fun validate(license: String, connectIp: String = ""): LicenseEntry? {
        val entry = licenses[license] ?: return null
        if (!entry.enabled) return null
        if (entry.isExpired()) return null
        if (!entry.isIpAllowed(connectIp)) return null
        return entry
    }

    fun renew(license: String, days: Int): Boolean {
        val entry = licenses[license] ?: return false
        val base = if (entry.expiresAt > System.currentTimeMillis()) entry.expiresAt else System.currentTimeMillis()
        licenses[license] = entry.copy(expiresAt = base + days * 86_400_000L)
        save()
        return true
    }

    /** 添加一个 IP 到允许列表 */
    fun addIp(license: String, ip: String): Boolean {
        val entry = licenses[license] ?: return false
        if (ip in entry.boundIps) return true
        licenses[license] = entry.copy(boundIps = entry.boundIps + ip)
        save()
        return true
    }

    /** 从允许列表移除一个 IP */
    fun removeIp(license: String, ip: String): Boolean {
        val entry = licenses[license] ?: return false
        licenses[license] = entry.copy(boundIps = entry.boundIps - ip)
        save()
        return true
    }

    /** 清空所有绑定 IP */
    fun clearIps(license: String): Boolean {
        val entry = licenses[license] ?: return false
        licenses[license] = entry.copy(boundIps = emptyList())
        save()
        return true
    }

    fun revoke(license: String): Boolean {
        val entry = licenses[license] ?: return false
        licenses[license] = entry.copy(enabled = false)
        save()
        return true
    }

    fun enable(license: String): Boolean {
        val entry = licenses[license] ?: return false
        licenses[license] = entry.copy(enabled = true)
        save()
        return true
    }

    fun get(license: String): LicenseEntry? = licenses[license]

    fun list(): List<LicenseEntry> = licenses.values.toList()
}
