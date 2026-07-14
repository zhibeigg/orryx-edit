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
        ),
        Migration(
            version = 4,
            description = "accounts sessions and role based access control",
            statements = listOf(
                """
                CREATE TABLE commercial_accounts (
                    account_id UUID PRIMARY KEY,
                    email VARCHAR(320) NOT NULL,
                    email_normalized VARCHAR(320) NOT NULL UNIQUE,
                    password_hash VARCHAR(512) NOT NULL,
                    display_name VARCHAR(80) NOT NULL,
                    status VARCHAR(32) NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE commercial_account_sessions (
                    session_id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    token_hash CHAR(64) NOT NULL UNIQUE,
                    csrf_token_hash CHAR(64) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    last_seen_at TIMESTAMPTZ NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    rotated_from_id UUID NULL REFERENCES commercial_account_sessions(session_id) ON DELETE SET NULL,
                    revoked_at TIMESTAMPTZ NULL
                )
                """.trimIndent(),
                "CREATE INDEX commercial_account_sessions_active_idx ON commercial_account_sessions (account_id, expires_at) WHERE revoked_at IS NULL",
                """
                CREATE TABLE rbac_roles (
                    code VARCHAR(64) PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    system_role BOOLEAN NOT NULL DEFAULT FALSE
                )
                """.trimIndent(),
                """
                CREATE TABLE rbac_permissions (
                    code VARCHAR(100) PRIMARY KEY,
                    description VARCHAR(255) NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE rbac_role_permissions (
                    role_code VARCHAR(64) NOT NULL REFERENCES rbac_roles(code) ON DELETE CASCADE,
                    permission_code VARCHAR(100) NOT NULL REFERENCES rbac_permissions(code) ON DELETE CASCADE,
                    PRIMARY KEY (role_code, permission_code)
                )
                """.trimIndent(),
                """
                CREATE TABLE commercial_account_roles (
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    role_code VARCHAR(64) NOT NULL REFERENCES rbac_roles(code) ON DELETE CASCADE,
                    scope_type VARCHAR(32) NOT NULL DEFAULT 'GLOBAL',
                    scope_id VARCHAR(128) NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (account_id, role_code, scope_type, scope_id)
                )
                """.trimIndent(),
                "INSERT INTO rbac_roles(code, name, system_role) VALUES ('OWNER', 'Workspace Owner', TRUE), ('ADMIN', 'System Administrator', TRUE), ('MEMBER', 'Workspace Member', TRUE) ON CONFLICT DO NOTHING",
                "INSERT INTO rbac_permissions(code, description) VALUES ('workspace.read', 'Read workspace'), ('workspace.write_draft', 'Write cloud drafts'), ('workspace.publish', 'Publish releases'), ('billing.read', 'Read billing'), ('billing.purchase', 'Create purchases'), ('ai.use', 'Use AI jobs'), ('admin.system', 'Manage system') ON CONFLICT DO NOTHING",
                "INSERT INTO rbac_role_permissions(role_code, permission_code) SELECT 'OWNER', code FROM rbac_permissions WHERE code <> 'admin.system' ON CONFLICT DO NOTHING",
                "INSERT INTO rbac_role_permissions(role_code, permission_code) SELECT 'ADMIN', code FROM rbac_permissions ON CONFLICT DO NOTHING",
                "INSERT INTO rbac_role_permissions(role_code, permission_code) SELECT 'MEMBER', code FROM rbac_permissions WHERE code IN ('workspace.read', 'workspace.write_draft', 'billing.read', 'ai.use') ON CONFLICT DO NOTHING"
            )
        ),
        Migration(
            version = 5,
            description = "license claims server instances memberships and entitlements",
            statements = listOf(
                """
                CREATE TABLE commercial_license_claims (
                    license_key VARCHAR(128) PRIMARY KEY REFERENCES licenses(license_key) ON DELETE CASCADE,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    workspace_id UUID NOT NULL,
                    status VARCHAR(24) NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
                    claimed_at TIMESTAMPTZ NOT NULL,
                    released_at TIMESTAMPTZ NULL
                )
                """.trimIndent(),
                "CREATE UNIQUE INDEX commercial_license_claims_active_account_idx ON commercial_license_claims (account_id, license_key) WHERE status = 'ACTIVE'",
                """
                CREATE TABLE commercial_workspace_memberships (
                    workspace_id UUID NOT NULL,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    role VARCHAR(24) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (workspace_id, account_id)
                )
                """.trimIndent(),
                """
                CREATE TABLE commercial_server_instances (
                    instance_id UUID PRIMARY KEY,
                    license_key VARCHAR(128) NOT NULL REFERENCES commercial_license_claims(license_key) ON DELETE CASCADE,
                    workspace_id UUID NOT NULL,
                    stable_server_id VARCHAR(128) NOT NULL,
                    display_name VARCHAR(80) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    last_seen_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (license_key, stable_server_id)
                )
                """.trimIndent(),
                "CREATE INDEX commercial_server_instances_workspace_idx ON commercial_server_instances (workspace_id, last_seen_at DESC)",
                """
                CREATE TABLE commercial_entitlements (
                    entitlement_id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    entitlement_type VARCHAR(64) NOT NULL,
                    source_type VARCHAR(64) NOT NULL,
                    source_id VARCHAR(128) NOT NULL,
                    granted_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (account_id, entitlement_type),
                    UNIQUE (source_type, source_id)
                )
                """.trimIndent(),
                "ALTER TABLE editor_sessions ADD COLUMN server_instance_id UUID NULL REFERENCES commercial_server_instances(instance_id) ON DELETE SET NULL"
            )
        ),
        Migration(
            version = 6,
            description = "product catalog wallet balances and append only ledger",
            statements = listOf(
                """
                CREATE TABLE products (
                    code VARCHAR(64) PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    price_amount BIGINT NOT NULL CHECK (price_amount >= 0),
                    currency CHAR(3) NOT NULL,
                    gift_amount BIGINT NOT NULL DEFAULT 0 CHECK (gift_amount >= 0),
                    entitlement_type VARCHAR(64) NULL,
                    enabled BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                "INSERT INTO products(code, name, price_amount, currency, gift_amount, entitlement_type, enabled, created_at, updated_at) VALUES ('AI_PERMANENT_99', 'Orryx AI Editor Permanent', 9900, 'CNY', 5000, 'AI_EDITOR_PERMANENT', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING",
                """
                CREATE TABLE commercial_wallets (
                    account_id UUID PRIMARY KEY REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    gift_cents BIGINT NOT NULL DEFAULT 0 CHECK (gift_cents >= 0),
                    cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (cash_cents >= 0),
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE commercial_wallet_ledger (
                    entry_id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    operation_type VARCHAR(32) NOT NULL CHECK (operation_type IN ('CREDIT_GIFT', 'CREDIT_CASH', 'DEBIT', 'WITHDRAW_CASH', 'RESERVE', 'CAPTURE', 'RELEASE')),
                    business_key VARCHAR(128) NOT NULL UNIQUE,
                    gift_delta_cents BIGINT NOT NULL,
                    cash_delta_cents BIGINT NOT NULL,
                    gift_balance_cents BIGINT NOT NULL CHECK (gift_balance_cents >= 0),
                    cash_balance_cents BIGINT NOT NULL CHECK (cash_balance_cents >= 0),
                    description VARCHAR(160) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                "CREATE INDEX commercial_wallet_ledger_account_idx ON commercial_wallet_ledger (account_id, created_at DESC, entry_id)"
            )
        ),
        Migration(
            version = 7,
            description = "provider neutral payment orders and Alipay events",
            statements = listOf(
                """
                CREATE TABLE commercial_payment_orders (
                    order_id UUID PRIMARY KEY,
                    merchant_order_no VARCHAR(64) NOT NULL UNIQUE,
                    request_key VARCHAR(128) NOT NULL UNIQUE,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE RESTRICT,
                    product_id VARCHAR(64) NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
                    provider VARCHAR(32) NOT NULL CHECK (provider = 'ALIPAY'),
                    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
                    gift_cents BIGINT NOT NULL CHECK (gift_cents >= 0),
                    status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CLOSED')),
                    provider_transaction_id VARCHAR(128) NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    paid_at TIMESTAMPTZ NULL
                )
                """.trimIndent(),
                "CREATE UNIQUE INDEX commercial_payment_provider_transaction_idx ON commercial_payment_orders (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL",
                "CREATE UNIQUE INDEX commercial_payment_active_product_idx ON commercial_payment_orders (account_id, product_id, provider) WHERE status = 'PENDING'",
                """
                CREATE TABLE commercial_payment_events (
                    event_id VARCHAR(160) PRIMARY KEY,
                    provider VARCHAR(32) NOT NULL,
                    order_id UUID NULL REFERENCES commercial_payment_orders(order_id) ON DELETE SET NULL,
                    payload_sha256 CHAR(64) NOT NULL,
                    verified BOOLEAN NOT NULL,
                    received_at TIMESTAMPTZ NOT NULL,
                    processed_at TIMESTAMPTZ NULL,
                    error_code VARCHAR(100) NULL
                )
                """.trimIndent()
            )
        ),
        Migration(
            version = 8,
            description = "AI provider registry and wallet usage reservations",
            statements = listOf(
                """
                CREATE TABLE ai_providers (
                    provider_id VARCHAR(64) PRIMARY KEY,
                    provider_type VARCHAR(32) NOT NULL,
                    display_name VARCHAR(100) NOT NULL,
                    base_url TEXT NOT NULL,
                    default_model VARCHAR(128) NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    config JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                """
                CREATE TABLE ai_usage_reservations (
                    id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    job_id UUID NOT NULL UNIQUE,
                    reserved_gift_cents BIGINT NOT NULL CHECK (reserved_gift_cents >= 0),
                    reserved_cash_cents BIGINT NOT NULL CHECK (reserved_cash_cents >= 0),
                    captured_cents BIGINT NULL CHECK (captured_cents IS NULL OR captured_cents >= 0),
                    status VARCHAR(24) NOT NULL CHECK (status IN ('RESERVED', 'CAPTURED', 'RELEASED')),
                    idempotency_key VARCHAR(128) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (account_id, idempotency_key)
                )
                """.trimIndent()
            )
        ),
        Migration(
            version = 9,
            description = "asynchronous AI jobs runner executions and progress events",
            statements = listOf(
                """
                CREATE TABLE ai_jobs (
                    id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    server_instance_id UUID NOT NULL REFERENCES commercial_server_instances(instance_id) ON DELETE CASCADE,
                    draft_id UUID NULL,
                    base_version_id UUID NULL,
                    status VARCHAR(24) NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
                    operation VARCHAR(32) NOT NULL CHECK (operation IN ('GENERATE', 'VALIDATE', 'PLAN')),
                    prompt TEXT NOT NULL,
                    provider_id VARCHAR(64) NOT NULL REFERENCES ai_providers(provider_id) ON DELETE RESTRICT,
                    model VARCHAR(128) NOT NULL,
                    idempotency_key VARCHAR(128) NOT NULL,
                    lease_owner VARCHAR(128) NULL,
                    lease_expires_at TIMESTAMPTZ NULL,
                    provider_request JSONB NULL,
                    provider_response JSONB NULL,
                    runner_request JSONB NULL,
                    runner_result JSONB NULL,
                    input_tokens BIGINT NULL CHECK (input_tokens IS NULL OR input_tokens >= 0),
                    output_tokens BIGINT NULL CHECK (output_tokens IS NULL OR output_tokens >= 0),
                    cost_amount BIGINT NULL CHECK (cost_amount IS NULL OR cost_amount >= 0),
                    error_code VARCHAR(100) NULL,
                    error_message TEXT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    started_at TIMESTAMPTZ NULL,
                    finished_at TIMESTAMPTZ NULL,
                    UNIQUE (account_id, idempotency_key)
                )
                """.trimIndent(),
                "CREATE INDEX ai_jobs_claim_idx ON ai_jobs (status, lease_expires_at, created_at)",
                "ALTER TABLE ai_usage_reservations ADD CONSTRAINT ai_usage_reservations_job_fk FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE CASCADE",
                """
                CREATE TABLE ai_job_events (
                    job_id UUID NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
                    seq BIGINT NOT NULL CHECK (seq > 0),
                    event_type VARCHAR(64) NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (job_id, seq)
                )
                """.trimIndent(),
                """
                CREATE TABLE runner_executions (
                    id UUID PRIMARY KEY,
                    job_id UUID NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
                    operation VARCHAR(32) NOT NULL CHECK (operation IN ('generate', 'validate', 'plan')),
                    status VARCHAR(24) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
                    request_payload JSONB NOT NULL,
                    response_payload JSONB NULL,
                    error_code VARCHAR(100) NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    finished_at TIMESTAMPTZ NULL
                )
                """.trimIndent()
            )
        ),
        Migration(
            version = 10,
            description = "server snapshots and content addressed snapshot files",
            statements = listOf(
                """
                CREATE TABLE server_snapshots (
                    id UUID PRIMARY KEY,
                    server_instance_id UUID NOT NULL REFERENCES commercial_server_instances(instance_id) ON DELETE CASCADE,
                    manifest_revision CHAR(64) NOT NULL,
                    source VARCHAR(32) NOT NULL CHECK (source IN ('PLUGIN', 'BROWSER', 'IMPORT')),
                    created_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (server_instance_id, manifest_revision)
                )
                """.trimIndent(),
                """
                CREATE TABLE snapshot_files (
                    snapshot_id UUID NOT NULL REFERENCES server_snapshots(id) ON DELETE CASCADE,
                    path VARCHAR(2048) NOT NULL,
                    revision CHAR(64) NOT NULL,
                    size BIGINT NOT NULL CHECK (size >= 0),
                    content TEXT NULL,
                    PRIMARY KEY (snapshot_id, path)
                )
                """.trimIndent()
            )
        ),
        Migration(
            version = 11,
            description = "cloud drafts immutable versions and content addressed files",
            statements = listOf(
                """
                CREATE TABLE drafts (
                    id UUID PRIMARY KEY,
                    account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE CASCADE,
                    server_instance_id UUID NOT NULL REFERENCES commercial_server_instances(instance_id) ON DELETE CASCADE,
                    base_snapshot_id UUID NOT NULL REFERENCES server_snapshots(id) ON DELETE RESTRICT,
                    title VARCHAR(160) NOT NULL,
                    status VARCHAR(24) NOT NULL CHECK (status IN ('OPEN', 'ARCHIVED')),
                    current_version BIGINT NOT NULL DEFAULT 0 CHECK (current_version >= 0),
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """.trimIndent(),
                "CREATE INDEX drafts_owner_workspace_idx ON drafts (account_id, server_instance_id, updated_at DESC)",
                """
                CREATE TABLE draft_versions (
                    id UUID PRIMARY KEY,
                    draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    version_number BIGINT NOT NULL CHECK (version_number > 0),
                    parent_version_id UUID NULL REFERENCES draft_versions(id) ON DELETE RESTRICT,
                    source VARCHAR(24) NOT NULL CHECK (source IN ('MANUAL', 'AI', 'IMPORT')),
                    manifest_revision CHAR(64) NOT NULL,
                    author_account_id UUID NOT NULL REFERENCES commercial_accounts(account_id) ON DELETE RESTRICT,
                    created_at TIMESTAMPTZ NOT NULL,
                    UNIQUE (draft_id, version_number)
                )
                """.trimIndent(),
                """
                CREATE TABLE draft_files (
                    version_id UUID NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE,
                    path VARCHAR(2048) NOT NULL,
                    change_type VARCHAR(16) NOT NULL CHECK (change_type IN ('UPSERT', 'DELETE')),
                    base_revision CHAR(64) NULL,
                    content_revision CHAR(64) NULL,
                    size BIGINT NULL CHECK (size IS NULL OR size >= 0),
                    content TEXT NULL,
                    PRIMARY KEY (version_id, path),
                    CHECK ((change_type = 'DELETE' AND content_revision IS NULL AND size IS NULL AND content IS NULL) OR (change_type = 'UPSERT' AND content_revision IS NOT NULL AND size IS NOT NULL AND content IS NOT NULL))
                )
                """.trimIndent(),
                "ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_draft_fk FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE SET NULL",
                "ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_base_version_fk FOREIGN KEY (base_version_id) REFERENCES draft_versions(id) ON DELETE SET NULL"
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
