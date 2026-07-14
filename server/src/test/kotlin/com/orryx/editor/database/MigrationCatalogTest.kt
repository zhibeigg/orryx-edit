package com.orryx.editor.database

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
            "update_jobs", "legacy_imports", "kether_docs_cache", "kether_docs_sync_state",
            "commercial_accounts", "commercial_account_sessions", "rbac_roles", "rbac_permissions",
            "commercial_account_roles", "commercial_license_claims", "commercial_workspace_memberships",
            "commercial_server_instances", "commercial_entitlements", "products", "commercial_wallets",
            "commercial_wallet_ledger", "commercial_payment_orders", "commercial_payment_events", "ai_providers",
            "ai_usage_reservations", "ai_jobs", "ai_job_events", "runner_executions",
            "server_snapshots", "snapshot_files", "drafts", "draft_versions", "draft_files",
            "commercial_release_signing_keys", "commercial_releases", "commercial_release_files",
            "commercial_plugin_release_transactions", "commercial_release_events", "commercial_release_transfer_grants"
        ).forEach { assertTrue(sql.contains("CREATE TABLE $it"), "missing table $it") }
        listOf(
            "workspace_id", "server_key", "server_id", "player_name", "browser_id", "instance_id", "lease_expires_at",
            "release_id", "schema_sha256", "schema_json", "last_success_at", "next_attempt_at",
            "csrf_token_hash", "reserved_gift_cents", "reserved_cash_cents", "captured_cents",
            "REFERENCES commercial_accounts(account_id)", "REFERENCES commercial_server_instances(instance_id)",
            "canonical_payload", "request_fingerprint", "state_version", "lease_owner", "event_key", "token_hash",
            "RECOVERY_REQUIRED", "commercial_plugin_release_one_active_idx", "reject_commercial_release_mutation",
            "'PLUGIN', 'BROWSER', 'IMPORT', 'RELEASE'"
        ).forEach { assertTrue(sql.contains(it), "missing schema contract $it") }
        assertFalse(sql.contains("private_key", ignoreCase = true), "release signing private key must never be stored")
        assertTrue(MigrationCatalog.migrations.zipWithNext().all { it.first.version < it.second.version })
        assertEquals(12L, MigrationCatalog.migrations.last().version)
    }
}
