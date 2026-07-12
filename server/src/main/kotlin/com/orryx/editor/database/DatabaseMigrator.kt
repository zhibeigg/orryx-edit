package com.orryx.editor.database

import io.r2dbc.spi.Connection

class DatabaseMigrator(
    private val database: R2dbcDatabase,
    private val migrations: List<Migration> = MigrationCatalog.migrations,
    private val advisoryLockKey: Long = 4_794_998_894_225_489_223L
) {
    suspend fun migrate() {
        database.inTransaction { connection ->
            connection.executeFully(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version BIGINT PRIMARY KEY,
                    description VARCHAR(255) NOT NULL,
                    checksum CHAR(64) NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """.trimIndent()
            )
            queryAll(
                connection.createStatement("SELECT pg_advisory_xact_lock($1)").bind(0, advisoryLockKey)
            ) { _, _ -> Unit }
            val applied = queryAll(
                connection.createStatement("SELECT version, checksum FROM schema_migrations ORDER BY version")
            ) { row, _ -> row.get("version", java.lang.Long::class.java)!!.toLong() to row.get("checksum", String::class.java)!! }
                .toMap()

            migrations.forEach { migration -> applyMigration(connection, migration, applied[migration.version]) }
        }
    }

    private suspend fun applyMigration(connection: Connection, migration: Migration, appliedChecksum: String?) {
        if (appliedChecksum != null) {
            check(appliedChecksum == migration.checksum) {
                "迁移 ${migration.version} checksum 不匹配：数据库=$appliedChecksum，代码=${migration.checksum}"
            }
            return
        }
        migration.statements.forEach { connection.executeFully(it) }
        executeFully(
            connection.createStatement(
                "INSERT INTO schema_migrations(version, description, checksum) VALUES ($1, $2, $3)"
            )
                .bind(0, migration.version)
                .bind(1, migration.description)
                .bind(2, migration.checksum)
        )
    }
}
