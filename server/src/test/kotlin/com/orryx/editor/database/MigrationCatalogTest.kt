package com.orryx.editor.database

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class MigrationCatalogTest {
    @Test
    fun `sha256 checksum is deterministic`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sha256("abc")
        )
        assertEquals(MigrationCatalog.migrations.first().checksum, MigrationCatalog.migrations.first().checksum)
        assertNotEquals(
            Migration(version = 1, description = "x", statements = listOf("SELECT 1")).checksum,
            Migration(version = 1, description = "x", statements = listOf("SELECT 2")).checksum
        )
    }

    @Test
    fun `catalog contains required tables and ordered versions`() {
        val sql = MigrationCatalog.migrations.flatMap { it.statements }.joinToString("\n")
        listOf(
            "licenses", "license_bound_ips", "editor_sessions", "system_audit_events",
            "update_jobs", "legacy_imports"
        ).forEach { assertTrue(sql.contains("CREATE TABLE $it")) }
        listOf("workspace_id", "server_key", "server_id", "player_name", "browser_id", "instance_id", "lease_expires_at")
            .forEach { assertTrue(sql.contains(it)) }
        assertTrue(MigrationCatalog.migrations.zipWithNext().all { it.first.version < it.second.version })
    }
}
