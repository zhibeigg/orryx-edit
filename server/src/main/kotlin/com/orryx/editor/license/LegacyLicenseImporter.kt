package com.orryx.editor.license

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import com.orryx.editor.database.sha256
import com.orryx.editor.security.normalizeIpAddress
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.channels.AsynchronousFileChannel
import java.nio.channels.CompletionHandler
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed interface LegacyImportResult {
    data object SourceMissing : LegacyImportResult
    data class AlreadyImported(val checksum: String) : LegacyImportResult
    data class Imported(val checksum: String, val count: Int) : LegacyImportResult
}

class LegacyLicenseImporter(
    private val database: R2dbcDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    suspend fun importOnce(source: Path, now: Instant = Instant.now()): LegacyImportResult {
        val bytes = try {
            readAsynchronously(source)
        } catch (_: NoSuchFileException) {
            return LegacyImportResult.SourceMissing
        }
        val checksum = sha256(bytes)
        val entries = json.decodeFromString<List<LegacyLicenseEntry>>(bytes.decodeToString())
        val sourceName = source.toAbsolutePath().normalize().toString()
        return database.inTransaction { connection ->
            val alreadyImported = queryOne(
                connection.createStatement(
                    "SELECT 1 FROM legacy_imports WHERE source_name = $1 AND content_sha256 = $2"
                ).bind(0, sourceName).bind(1, checksum)
            ) { _, _ -> true } ?: false
            if (alreadyImported) return@inTransaction LegacyImportResult.AlreadyImported(checksum)

            var imported = 0
            entries.forEach { legacy ->
                val expiresAt = legacy.expiresAt.takeIf { it > 0 }?.let(Instant::ofEpochMilli)
                val normalizedIps = legacy.boundIps.mapNotNull(::normalizeIpAddress).distinct()
                val inserted = executeFully(
                    connection.createStatement(
                        """
                        INSERT INTO licenses(
                            license_key, owner, server_key, enabled, max_bound_ips, created_at, expires_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (license_key) DO NOTHING
                        """.trimIndent()
                    )
                        .bind(0, legacy.license)
                        .bind(1, legacy.owner)
                        .bind(2, legacy.serverKey)
                        .bind(3, legacy.enabled)
                        .bind(4, maxOf(1, normalizedIps.size))
                        .bind(5, Instant.ofEpochMilli(legacy.createdAt))
                        .let { statement ->
                            if (expiresAt == null) statement.bindNull(6, Instant::class.java) else statement.bind(6, expiresAt)
                        }
                        .bind(7, now)
                )
                if (inserted > 0) {
                    imported++
                    normalizedIps.forEach { ip ->
                        executeFully(
                            connection.createStatement(
                                """
                                INSERT INTO license_bound_ips(license_key, ip_address, created_at)
                                VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
                                """.trimIndent()
                            ).bind(0, legacy.license).bind(1, ip).bind(2, now)
                        )
                    }
                }
            }
            executeFully(
                connection.createStatement(
                    "INSERT INTO legacy_imports(source_name, content_sha256, imported_count, imported_at) VALUES ($1, $2, $3, $4)"
                ).bind(0, sourceName).bind(1, checksum).bind(2, imported).bind(3, now)
            )
            LegacyImportResult.Imported(checksum, imported)
        }
    }
}

@Serializable
private data class LegacyLicenseEntry(
    val license: String,
    val owner: String,
    val createdAt: Long,
    val expiresAt: Long = 0,
    val boundIps: List<String> = emptyList(),
    val serverKey: String,
    val enabled: Boolean = true
)

private suspend fun readAsynchronously(path: Path): ByteArray {
    val channel = AsynchronousFileChannel.open(path, StandardOpenOption.READ)
    try {
        val output = ByteArrayOutputStream()
        var position = 0L
        while (true) {
            val buffer = ByteBuffer.allocate(16 * 1024)
            val read = channel.awaitRead(buffer, position)
            if (read < 0) break
            if (read == 0) continue
            position += read
            buffer.flip()
            val chunk = ByteArray(read)
            buffer.get(chunk)
            output.write(chunk)
        }
        return output.toByteArray()
    } finally {
        channel.close()
    }
}

private suspend fun AsynchronousFileChannel.awaitRead(buffer: ByteBuffer, position: Long): Int =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { runCatching { close() } }
        read(buffer, position, Unit, object : CompletionHandler<Int, Unit> {
            override fun completed(result: Int, attachment: Unit) {
                if (continuation.isActive) continuation.resume(result)
            }

            override fun failed(exc: Throwable, attachment: Unit) {
                if (continuation.isActive) continuation.resumeWithException(exc)
            }
        })
    }
