package com.orryx.editor.database

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

data class Migration(
    val version: Long,
    val description: String,
    val statements: List<String>
) {
    val checksum: String = sha256(statements.joinToString("\u0000") { it.trim() })
}

object MigrationCatalog {
    val migrations: List<Migration> = listOf(
        Migration(
            version = 1,
            description = "initial persistence schema",
            statements = listOf(
                """
                CREATE TABLE licenses (
                    license_key VARCHAR(128) PRIMARY KEY,
                    owner VARCHAR(100) NOT NULL,
                    server_key VARCHAR(128) NOT NULL UNIQUE,
                    enabled BOOLEAN NOT NULL DEFAULT TRUE,
                    max_bound_ips INTEGER NOT NULL DEFAULT 1 CHECK (max_bound_ips >= 0),
                    created_at TIMESTAMPTZ NOT NULL,
                    expires_at TIMESTAMPTZ NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE license_bound_ips (
                    license_key VARCHAR(128) NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
                    ip_address VARCHAR(64) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (license_key, ip_address)
                )
                """.trimIndent(),
                """
                CREATE TABLE editor_sessions (
                    id UUID PRIMARY KEY,
                    license_key VARCHAR(128) NOT NULL REFERENCES licenses(license_key) ON DELETE CASCADE,
                    resume_token_hash CHAR(64) NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL,
                    last_seen_at TIMESTAMPTZ NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    revoked_at TIMESTAMPTZ NULL
                )
                """.trimIndent(),
                "CREATE INDEX editor_sessions_active_expiry_idx ON editor_sessions (expires_at) WHERE revoked_at IS NULL",
                """
                CREATE TABLE system_audit_events (
                    id UUID PRIMARY KEY,
                    event_type VARCHAR(100) NOT NULL,
                    actor VARCHAR(200) NULL,
                    subject VARCHAR(200) NULL,
                    details JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE update_jobs (
                    id UUID PRIMARY KEY,
                    job_type VARCHAR(100) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    error_message TEXT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE legacy_imports (
                    source_name VARCHAR(255) NOT NULL,
                    content_sha256 CHAR(64) NOT NULL,
                    imported_count INTEGER NOT NULL,
                    imported_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (source_name, content_sha256)
                )
                """.trimIndent()
            )
        ),
        Migration(
            version = 2,
            description = "relay session metadata and update job leasing",
            statements = listOf(
                "DELETE FROM editor_sessions",
                "ALTER TABLE editor_sessions ADD COLUMN workspace_id VARCHAR(128) NOT NULL",
                "ALTER TABLE editor_sessions ADD COLUMN server_key VARCHAR(128) NOT NULL",
                "ALTER TABLE editor_sessions ADD COLUMN server_id VARCHAR(128) NOT NULL",
                "ALTER TABLE editor_sessions ADD COLUMN player_name VARCHAR(128) NOT NULL",
                "ALTER TABLE editor_sessions ADD COLUMN browser_id VARCHAR(128) NOT NULL",
                "CREATE INDEX editor_sessions_workspace_idx ON editor_sessions (workspace_id, server_id)",
                "ALTER TABLE update_jobs ALTER COLUMN id TYPE VARCHAR(64) USING id::text",
                "ALTER TABLE update_jobs RENAME COLUMN job_type TO action",
                "ALTER TABLE update_jobs RENAME COLUMN error_message TO error_code",
                "ALTER TABLE update_jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100)",
                "ALTER TABLE update_jobs ADD COLUMN current_version VARCHAR(64) NOT NULL DEFAULT ''",
                "ALTER TABLE update_jobs ADD COLUMN latest_version VARCHAR(64) NULL",
                "ALTER TABLE update_jobs ADD COLUMN deployment VARCHAR(64) NOT NULL DEFAULT ''",
                "ALTER TABLE update_jobs ADD COLUMN active_users INTEGER NOT NULL DEFAULT 0 CHECK (active_users >= 0)",
                "ALTER TABLE update_jobs ADD COLUMN instance_id VARCHAR(128) NULL",
                "ALTER TABLE update_jobs ADD COLUMN lease_expires_at TIMESTAMPTZ NULL",
                "CREATE INDEX update_jobs_lease_idx ON update_jobs (status, lease_expires_at, created_at)"
            )
        ),
        Migration(
            version = 3,
            description = "verified Kether documentation cache and sync state",
            statements = listOf(
                """
                CREATE TABLE kether_docs_cache (
                    channel VARCHAR(16) PRIMARY KEY CHECK (channel = 'stable'),
                    release_id VARCHAR(256) NOT NULL,
                    plugin_version VARCHAR(64) NOT NULL,
                    commit_sha CHAR(40) NOT NULL,
                    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
                    schema_sha256 CHAR(64) NOT NULL,
                    schema_bytes BIGINT NOT NULL CHECK (schema_bytes > 0),
                    schema_json TEXT NOT NULL,
                    published_at TIMESTAMPTZ NOT NULL,
                    synced_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE kether_docs_sync_state (
                    channel VARCHAR(16) PRIMARY KEY CHECK (channel = 'stable'),
                    last_attempt_at TIMESTAMPTZ NULL,
                    last_success_at TIMESTAMPTZ NULL,
                    next_attempt_at TIMESTAMPTZ NULL,
                    error_code VARCHAR(100) NULL
                )
                """.trimIndent()
            )
        )
    )

    init {
        require(migrations.map { it.version }.distinct().size == migrations.size) { "迁移版本不能重复" }
        require(migrations.zipWithNext().all { (left, right) -> left.version < right.version }) { "迁移必须按版本升序排列" }
    }
}

internal fun sha256(value: String): String = sha256(value.toByteArray(StandardCharsets.UTF_8))

internal fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(value)
    .joinToString("") { "%02x".format(it) }
