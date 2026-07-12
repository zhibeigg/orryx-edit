package com.orryx.editor.license

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.bindNullable
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryAll
import com.orryx.editor.database.queryOne
import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import java.time.Instant

class PostgresLicenseRepository(private val database: R2dbcDatabase) : LicenseRepository {
    override suspend fun create(license: License): License = database.inTransaction { connection ->
        executeFully(
            connection.createStatement(
                """
                INSERT INTO licenses(
                    license_key, owner, server_key, enabled, max_bound_ips, created_at, expires_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """.trimIndent()
            )
                .bind(0, license.license)
                .bind(1, license.owner)
                .bind(2, license.serverKey)
                .bind(3, license.enabled)
                .bind(4, license.maxBoundIps)
                .bind(5, license.createdAt)
                .bindNullable(6, license.expiresAt)
                .bind(7, license.updatedAt)
        )
        license.boundIps.forEach { ip ->
            executeFully(
                connection.createStatement(
                    "INSERT INTO license_bound_ips(license_key, ip_address, created_at) VALUES ($1, $2, $3)"
                ).bind(0, license.license).bind(1, ip).bind(2, license.createdAt)
            )
        }
        license
    }

    override suspend fun find(licenseKey: String): License? = database.withConnection { connection ->
        find(connection, licenseKey)
    }

    override suspend fun list(): List<License> = database.withConnection { connection ->
        val licenses = queryAll(
            connection.createStatement("SELECT * FROM licenses ORDER BY created_at DESC, license_key")
        ) { row, _ -> row.toLicense(emptyList()) }
        if (licenses.isEmpty()) return@withConnection emptyList()
        val ips = queryAll(
            connection.createStatement("SELECT license_key, ip_address FROM license_bound_ips ORDER BY created_at, ip_address")
        ) { row, _ -> row.string("license_key") to row.string("ip_address") }
            .groupBy({ it.first }, { it.second })
        licenses.map { it.copy(boundIps = ips[it.license].orEmpty()) }
    }

    override suspend fun renew(licenseKey: String, days: Int, now: Instant): License? = database.inTransaction { connection ->
        val updated = queryOne(
            connection.createStatement(
                """
                UPDATE licenses
                SET expires_at = GREATEST(COALESCE(expires_at, $2), $2) + make_interval(days => $3),
                    updated_at = $2
                WHERE license_key = $1
                RETURNING *
                """.trimIndent()
            ).bind(0, licenseKey).bind(1, now).bind(2, days)
        ) { row, _ -> row.toLicense(emptyList()) } ?: return@inTransaction null
        updated.copy(boundIps = boundIps(connection, licenseKey))
    }

    override suspend fun setEnabled(licenseKey: String, enabled: Boolean, now: Instant): Boolean =
        database.inTransaction { connection ->
            executeFully(
                connection.createStatement(
                    "UPDATE licenses SET enabled = $2, updated_at = $3 WHERE license_key = $1"
                ).bind(0, licenseKey).bind(1, enabled).bind(2, now)
            ) > 0
        }

    override suspend fun addBoundIp(licenseKey: String, ip: String, now: Instant): AddIpResult =
        database.inTransaction { connection ->
            val maxIps = queryOne(
                connection.createStatement("SELECT max_bound_ips FROM licenses WHERE license_key = $1 FOR UPDATE")
                    .bind(0, licenseKey)
            ) { row, _ -> row.get("max_bound_ips", Integer::class.java)!!.toInt() }
                ?: return@inTransaction AddIpResult.LICENSE_NOT_FOUND
            val existing = queryOne(
                connection.createStatement(
                    "SELECT 1 FROM license_bound_ips WHERE license_key = $1 AND ip_address = $2"
                ).bind(0, licenseKey).bind(1, ip)
            ) { _, _ -> true } ?: false
            if (existing) return@inTransaction AddIpResult.ALREADY_BOUND
            val count = queryOne(
                connection.createStatement("SELECT COUNT(*) AS count FROM license_bound_ips WHERE license_key = $1")
                    .bind(0, licenseKey)
            ) { row, _ -> row.get("count", java.lang.Long::class.java)!!.toLong() } ?: 0L
            if (count >= maxIps) return@inTransaction AddIpResult.LIMIT_REACHED
            executeFully(
                connection.createStatement(
                    "INSERT INTO license_bound_ips(license_key, ip_address, created_at) VALUES ($1, $2, $3)"
                ).bind(0, licenseKey).bind(1, ip).bind(2, now)
            )
            executeFully(
                connection.createStatement("UPDATE licenses SET updated_at = $2 WHERE license_key = $1")
                    .bind(0, licenseKey).bind(1, now)
            )
            AddIpResult.ADDED
        }

    override suspend fun removeBoundIp(licenseKey: String, ip: String, now: Instant): Boolean =
        database.inTransaction { connection ->
            val exists = lockLicense(connection, licenseKey)
            if (!exists) return@inTransaction false
            executeFully(
                connection.createStatement("DELETE FROM license_bound_ips WHERE license_key = $1 AND ip_address = $2")
                    .bind(0, licenseKey).bind(1, ip)
            )
            executeFully(
                connection.createStatement("UPDATE licenses SET updated_at = $2 WHERE license_key = $1")
                    .bind(0, licenseKey).bind(1, now)
            )
            true
        }

    override suspend fun clearBoundIps(licenseKey: String, now: Instant): Boolean = database.inTransaction { connection ->
        val exists = lockLicense(connection, licenseKey)
        if (!exists) return@inTransaction false
        executeFully(
            connection.createStatement("DELETE FROM license_bound_ips WHERE license_key = $1").bind(0, licenseKey)
        )
        executeFully(
            connection.createStatement("UPDATE licenses SET updated_at = $2 WHERE license_key = $1")
                .bind(0, licenseKey).bind(1, now)
        )
        true
    }

    private suspend fun find(connection: Connection, licenseKey: String): License? {
        val license = queryOne(
            connection.createStatement("SELECT * FROM licenses WHERE license_key = $1").bind(0, licenseKey)
        ) { row, _ -> row.toLicense(emptyList()) } ?: return null
        return license.copy(boundIps = boundIps(connection, licenseKey))
    }

    private suspend fun boundIps(connection: Connection, licenseKey: String): List<String> = queryAll(
        connection.createStatement(
            "SELECT ip_address FROM license_bound_ips WHERE license_key = $1 ORDER BY created_at, ip_address"
        ).bind(0, licenseKey)
    ) { row, _ -> row.string("ip_address") }

    private suspend fun lockLicense(connection: Connection, licenseKey: String): Boolean = queryOne(
        connection.createStatement("SELECT 1 FROM licenses WHERE license_key = $1 FOR UPDATE").bind(0, licenseKey)
    ) { _, _ -> true } ?: false
}

private fun Row.toLicense(boundIps: List<String>): License = License(
    license = string("license_key"),
    owner = string("owner"),
    createdAt = instant("created_at"),
    expiresAt = get("expires_at", Instant::class.java),
    boundIps = boundIps,
    serverKey = string("server_key"),
    enabled = get("enabled", java.lang.Boolean::class.java)!!.booleanValue(),
    maxBoundIps = get("max_bound_ips", Integer::class.java)!!.toInt(),
    updatedAt = instant("updated_at")
)

private fun Row.string(name: String): String = get(name, String::class.java)!!
private fun Row.instant(name: String): Instant = get(name, Instant::class.java)!!
