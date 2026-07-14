package com.orryx.editor.config

import java.nio.file.Paths
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AppConfigTest {
    @Test
    fun `parses database pool timeouts and legacy path centrally`() {
        val config = AppConfig.load(
            mapOf(
                "ADMIN_KEY" to "0123456789abcdef",
                "DATABASE_URL" to "postgres://db.example.com:5432/orryx",
                "DATABASE_USER" to "orryx",
                "DATABASE_PASSWORD" to "secret",
                "DATABASE_POOL_MIN_SIZE" to "2",
                "DATABASE_POOL_MAX_SIZE" to "12",
                "DATABASE_CONNECT_TIMEOUT_SECONDS" to "3",
                "DATABASE_MAX_IDLE_TIME_SECONDS" to "60",
                "DATA_DIR" to "build/test-data",
                "LEGACY_LICENSE_FILE" to "build/legacy/licenses.json"
            )
        )

        assertEquals("r2dbc:postgresql://db.example.com:5432/orryx", config.database.url)
        assertEquals(2, config.database.initialPoolSize)
        assertEquals(12, config.database.maxPoolSize)
        assertEquals(3000, config.database.acquireTimeout.toMillis())
        assertEquals(Paths.get("build/legacy/licenses.json").toAbsolutePath().normalize(), config.legacyLicensesFile)
        assertEquals(12, config.ketherDocs.syncInterval.toHours())
        assertEquals(true, config.ketherDocs.enabled)
        assertEquals(false, config.editorProtocol.v2Enabled)
        assertEquals(false, config.editorProtocol.v2WritesEnabled)
    }

    @Test
    fun `editor protocol v2 flags are opt in and strictly parsed`() {
        val base = mapOf(
            "ADMIN_KEY" to "0123456789abcdef",
            "DATABASE_URL" to "postgresql://localhost/orryx"
        )
        val enabled = AppConfig.load(base + mapOf(
            "EDITOR_PROTOCOL_V2_ENABLED" to "true",
            "EDITOR_V2_WRITES_ENABLED" to "true",
        ))
        assertEquals(true, enabled.editorProtocol.v2Enabled)
        assertEquals(true, enabled.editorProtocol.v2WritesEnabled)
        assertFailsWith<IllegalArgumentException> {
            AppConfig.load(base + ("EDITOR_PROTOCOL_V2_ENABLED" to "yes"))
        }
        assertFailsWith<IllegalArgumentException> {
            AppConfig.load(base + ("EDITOR_V2_WRITES_ENABLED" to "true"))
        }
    }

    @Test
    fun `requires database url and valid pool bounds`() {
        assertFailsWith<IllegalArgumentException> { AppConfig.load(emptyMap()) }
        assertFailsWith<IllegalArgumentException> {
            AppConfig.load(
                mapOf(
                    "DATABASE_URL" to "postgresql://localhost/orryx",
                    "DATABASE_POOL_INITIAL_SIZE" to "5",
                    "DATABASE_POOL_MAX_SIZE" to "2"
                )
            )
        }
        assertFailsWith<IllegalArgumentException> {
            AppConfig.load(
                mapOf(
                    "ADMIN_KEY" to "0123456789abcdef",
                    "DATABASE_URL" to "postgresql://localhost/orryx",
                    "KETHER_DOCS_SYNC_INTERVAL_HOURS" to "0"
                )
            )
        }
    }
}
