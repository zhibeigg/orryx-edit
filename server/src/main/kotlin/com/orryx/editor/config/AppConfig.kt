package com.orryx.editor.config

import com.orryx.editor.build.BuildInfo
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.loadSecuritySettings
import com.orryx.editor.security.requireSecureAdminKey
import com.orryx.editor.update.UpdateConfig
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Duration

data class DatabaseConfig(
    val url: String,
    val user: String?,
    val password: String?,
    val initialPoolSize: Int,
    val maxPoolSize: Int,
    val acquireTimeout: Duration,
    val idleTimeout: Duration,
    val statementTimeout: Duration
)

data class SessionConfig(
    val ttl: Duration,
    val cleanupInterval: Duration,
    val relayRequestTimeout: Duration
)

data class AppConfig(
    val port: Int,
    val adminKey: String,
    val database: DatabaseConfig,
    val dataDir: Path,
    val legacyLicensesFile: Path,
    val security: SecuritySettings,
    val sessions: SessionConfig,
    val updates: UpdateConfig,
    val buildInfo: BuildInfo
) {
    companion object {
        fun load(environment: Map<String, String> = System.getenv()): AppConfig {
            val dataDir = Paths.get(environment.value("DATA_DIR") ?: "data").toAbsolutePath().normalize()
            val databaseUrl = environment.value("DATABASE_URL").orEmpty()
            require(databaseUrl.isNotEmpty()) { "DATABASE_URL 不能为空" }

            val initialPoolSize = environment.intValue(
                names = arrayOf("DB_POOL_MIN_IDLE", "DATABASE_POOL_MIN_SIZE", "DATABASE_POOL_INITIAL_SIZE"),
                default = 1,
                range = 0..100
            )
            val maxPoolSize = environment.intValue(
                names = arrayOf("DB_POOL_MAX_SIZE", "DATABASE_POOL_MAX_SIZE"),
                default = 10,
                range = 1..100
            )
            require(initialPoolSize <= maxPoolSize) { "数据库最小连接数不能大于最大连接数" }

            val legacyPath = environment.value("LEGACY_LICENSE_FILE", "LEGACY_LICENSES_FILE")
                ?.let(Paths::get)
                ?: dataDir.resolve("licenses.json")
            val port = environment.intValue(arrayOf("PORT"), 9090, 1..65535)

            return AppConfig(
                port = port,
                adminKey = requireSecureAdminKey(environment["ADMIN_KEY"]),
                database = DatabaseConfig(
                    url = normalizeR2dbcUrl(databaseUrl),
                    user = environment.value("DATABASE_USER"),
                    password = environment["DATABASE_PASSWORD"]?.takeUnless(String::isEmpty),
                    initialPoolSize = initialPoolSize,
                    maxPoolSize = maxPoolSize,
                    acquireTimeout = environment.durationSeconds(
                        names = arrayOf("DB_CONNECT_TIMEOUT_SECONDS", "DATABASE_CONNECT_TIMEOUT_SECONDS"),
                        millisAliases = arrayOf("DATABASE_ACQUIRE_TIMEOUT_MS"),
                        defaultSeconds = 10,
                        range = 1L..300L
                    ),
                    idleTimeout = environment.durationSeconds(
                        names = arrayOf("DB_MAX_IDLE_SECONDS", "DATABASE_MAX_IDLE_TIME_SECONDS"),
                        millisAliases = arrayOf("DATABASE_IDLE_TIMEOUT_MS"),
                        defaultSeconds = 30 * 60,
                        range = 1L..86_400L
                    ),
                    statementTimeout = environment.durationSeconds(
                        names = arrayOf("DB_STATEMENT_TIMEOUT_SECONDS", "DATABASE_STATEMENT_TIMEOUT_SECONDS"),
                        defaultSeconds = 30,
                        range = 1L..300L
                    )
                ),
                dataDir = dataDir,
                legacyLicensesFile = legacyPath.toAbsolutePath().normalize(),
                security = loadSecuritySettings(environment),
                sessions = SessionConfig(
                    ttl = Duration.ofHours(environment.longValue("EDITOR_SESSION_TTL_HOURS", 24, 1L..720L)),
                    cleanupInterval = Duration.ofMinutes(environment.longValue("EDITOR_SESSION_CLEANUP_MINUTES", 15, 1L..1_440L)),
                    relayRequestTimeout = Duration.ofSeconds(environment.longValue("RELAY_REQUEST_TIMEOUT_SECONDS", 15, 5L..120L))
                ),
                updates = UpdateConfig.fromEnvironment(environment),
                buildInfo = BuildInfo.load(environment = environment)
            )
        }

        internal fun normalizeR2dbcUrl(value: String): String = when {
            value.startsWith("r2dbc:postgresql://") -> value
            value.startsWith("postgresql://") -> "r2dbc:$value"
            value.startsWith("postgres://") -> "r2dbc:postgresql://${value.removePrefix("postgres://")}" 
            else -> throw IllegalArgumentException("DATABASE_URL 必须使用 postgres://、postgresql:// 或 r2dbc:postgresql://")
        }
    }
}

private fun Map<String, String>.value(vararg names: String): String? = names.firstNotNullOfOrNull { name ->
    this[name]?.trim().takeUnless { it.isNullOrEmpty() }
}

private fun Map<String, String>.intValue(names: Array<String>, default: Int, range: IntRange): Int {
    val raw = value(*names)
    val parsed = raw?.toIntOrNull() ?: if (raw == null) default else throw IllegalArgumentException("${names.first()} 必须是整数")
    require(parsed in range) { "${names.first()} 必须在 ${range.first}..${range.last} 范围内" }
    return parsed
}

private fun Map<String, String>.longValue(name: String, default: Long, range: LongRange): Long {
    val raw = value(name)
    val parsed = raw?.toLongOrNull() ?: if (raw == null) default else throw IllegalArgumentException("$name 必须是整数")
    require(parsed in range) { "$name 必须在 ${range.first}..${range.last} 范围内" }
    return parsed
}

private fun Map<String, String>.durationSeconds(
    names: Array<String>,
    millisAliases: Array<String> = emptyArray(),
    defaultSeconds: Long,
    range: LongRange
): Duration {
    value(*names)?.let { raw ->
        val seconds = raw.toLongOrNull() ?: throw IllegalArgumentException("${names.first()} 必须是整数")
        require(seconds in range) { "${names.first()} 必须在 ${range.first}..${range.last} 范围内" }
        return Duration.ofSeconds(seconds)
    }
    value(*millisAliases)?.let { raw ->
        val millis = raw.toLongOrNull() ?: throw IllegalArgumentException("${millisAliases.first()} 必须是整数")
        require(millis in 1L..range.last * 1_000L) { "${millisAliases.first()} 超出允许范围" }
        return Duration.ofMillis(millis)
    }
    return Duration.ofSeconds(defaultSeconds)
}
