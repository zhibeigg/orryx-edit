package com.orryx.editor.config

import com.orryx.editor.build.BuildInfo
import com.orryx.editor.ketherdocs.KetherDocsConfig
import com.orryx.editor.security.SecuritySettings
import com.orryx.editor.security.loadSecuritySettings
import com.orryx.editor.security.requireSecureAdminKey
import com.orryx.editor.update.UpdateConfig
import java.nio.file.Path
import java.nio.file.Paths
import java.net.URI
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

data class EditorProtocolConfig(
    val v2Enabled: Boolean = false,
    val v2WritesEnabled: Boolean = false,
    val releaseTransactionsEnabled: Boolean = false,
) {
    init {
        require(!v2WritesEnabled || v2Enabled) { "启用 V2 写路径前必须先启用协议 V2" }
        require(!releaseTransactionsEnabled || v2Enabled) { "启用发布事务前必须先启用协议 V2" }
    }
}

data class CommercialFeatureConfig(
    val accountsEnabled: Boolean = false,
    val cloudDraftsEnabled: Boolean = false,
    val alipayEnabled: Boolean = false,
    val runnerEnabled: Boolean = false,
    val aiWorkbenchEnabled: Boolean = false,
) {
    init {
        require(!aiWorkbenchEnabled || accountsEnabled) { "启用 AI Workbench 前必须先启用账户系统" }
        require(!aiWorkbenchEnabled || cloudDraftsEnabled) { "AI 只能写入已启用的云端草稿" }
        require(!aiWorkbenchEnabled || runnerEnabled) { "启用 AI Workbench 前必须启用私有 Runner" }
        require(!alipayEnabled || accountsEnabled) { "启用支付宝前必须先启用账户系统" }
    }
}

data class AccountWebConfig(
    val sessionTtl: Duration,
    val secureCookie: Boolean,
    val cookieDomain: String?
)

data class ReleaseRuntimeConfig(
    val enabled: Boolean = false,
    val publicBaseUrl: URI? = null,
    val allowLocalHttp: Boolean = false,
    val signingPrivateKeyPkcs8Base64: String? = null,
    val signingPublicKeyX509Base64: String? = null,
    val transferTtl: Duration = Duration.ofMinutes(5),
    val transactionLease: Duration = Duration.ofSeconds(30),
    val readinessTimeout: Duration = Duration.ofMinutes(3),
    val maxReleaseBytes: Long = 67_108_864
) {
    init {
        if (enabled) {
            val baseUrl = requireNotNull(publicBaseUrl) { "启用发布事务时 RELEASE_PUBLIC_BASE_URL 不能为空" }
            val loopbackHttp = allowLocalHttp && baseUrl.scheme.equals("http", true) &&
                baseUrl.host?.lowercase() in setOf("127.0.0.1", "localhost", "::1")
            require((baseUrl.scheme.equals("https", true) || loopbackHttp) && baseUrl.host != null && baseUrl.userInfo == null) {
                "RELEASE_PUBLIC_BASE_URL 必须是无凭据的 HTTPS 地址，或显式允许的本机 HTTP 地址"
            }
            require(!signingPrivateKeyPkcs8Base64.isNullOrBlank()) { "启用发布事务时 RELEASE_SIGNING_PRIVATE_KEY_PKCS8_BASE64 不能为空" }
            require(!signingPublicKeyX509Base64.isNullOrBlank()) { "启用发布事务时 RELEASE_SIGNING_PUBLIC_KEY_X509_BASE64 不能为空" }
        }
    }
}

data class AlipayRuntimeConfig(
    val appId: String,
    val sellerId: String,
    val gateway: URI,
    val privateKey: String,
    val publicKey: String,
    val notifyUrl: String,
    val returnUrl: String?
) {
    init {
        require(gateway.scheme.equals("https", true) && gateway.host != null && gateway.userInfo == null) {
            "ALIPAY_GATEWAY 必须是无凭据的 HTTPS 地址"
        }
        listOfNotNull(notifyUrl, returnUrl).forEach { value ->
            val uri = URI(value)
            require(uri.scheme.equals("https", true) && uri.host != null && uri.userInfo == null) {
                "支付宝回调地址必须是无凭据的 HTTPS 地址"
            }
        }
    }
}

data class AiProviderRuntimeConfig(
    val providerId: String,
    val baseUrl: URI,
    val apiKey: String,
    val model: String,
    val requestTimeout: Duration,
    val maxResponseBytes: Long,
    val inputCostPerMillionCents: Long,
    val outputCostPerMillionCents: Long,
    val usageReservationCents: Long
)

data class RunnerRuntimeConfig(
    val endpoint: URI,
    val sharedSecret: String,
    val requestTimeout: Duration,
    val maxResponseBytes: Long
)

data class AppConfig(
    val port: Int,
    val adminKey: String,
    val database: DatabaseConfig,
    val dataDir: Path,
    val legacyLicensesFile: Path,
    val security: SecuritySettings,
    val sessions: SessionConfig,
    val editorProtocol: EditorProtocolConfig,
    val commercialFeatures: CommercialFeatureConfig,
    val accountWeb: AccountWebConfig,
    val release: ReleaseRuntimeConfig,
    val alipay: AlipayRuntimeConfig?,
    val aiProvider: AiProviderRuntimeConfig?,
    val runner: RunnerRuntimeConfig?,
    val updates: UpdateConfig,
    val ketherDocs: KetherDocsConfig,
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
            val commercialFeatures = CommercialFeatureConfig(
                accountsEnabled = environment.booleanValue("ACCOUNTS_ENABLED", false),
                cloudDraftsEnabled = environment.booleanValue("CLOUD_DRAFTS_ENABLED", false),
                alipayEnabled = environment.booleanValue("ALIPAY_ENABLED", false),
                runnerEnabled = environment.booleanValue("RUNNER_ENABLED", false),
                aiWorkbenchEnabled = environment.booleanValue("AI_WORKBENCH_ENABLED", false),
            )
            val releaseEnabled = environment.booleanValue("RELEASE_TRANSACTIONS_ENABLED", false)
            require(!releaseEnabled || commercialFeatures.accountsEnabled) {
                "启用发布事务前必须启用账户系统"
            }
            require(!releaseEnabled || commercialFeatures.cloudDraftsEnabled) {
                "启用发布事务前必须启用云端草稿"
            }

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
                editorProtocol = EditorProtocolConfig(
                    v2Enabled = environment.booleanValue("EDITOR_PROTOCOL_V2_ENABLED", false),
                    v2WritesEnabled = environment.booleanValue("EDITOR_V2_WRITES_ENABLED", false),
                    releaseTransactionsEnabled = releaseEnabled,
                ),
                commercialFeatures = commercialFeatures,
                accountWeb = AccountWebConfig(
                    sessionTtl = Duration.ofHours(environment.longValue("ACCOUNT_SESSION_TTL_HOURS", 168, 1L..8_760L)),
                    secureCookie = environment.booleanValue("ACCOUNT_COOKIE_SECURE", true),
                    cookieDomain = environment.value("ACCOUNT_COOKIE_DOMAIN")
                ),
                release = ReleaseRuntimeConfig(
                    enabled = releaseEnabled,
                    publicBaseUrl = environment.value("RELEASE_PUBLIC_BASE_URL")?.let(::URI),
                    allowLocalHttp = environment.booleanValue("RELEASE_ALLOW_LOCAL_HTTP", false),
                    signingPrivateKeyPkcs8Base64 = environment.value("RELEASE_SIGNING_PRIVATE_KEY_PKCS8_BASE64"),
                    signingPublicKeyX509Base64 = environment.value("RELEASE_SIGNING_PUBLIC_KEY_X509_BASE64"),
                    transferTtl = Duration.ofSeconds(environment.longValue("RELEASE_TRANSFER_TTL_SECONDS", 300, 30L..3_600L)),
                    transactionLease = Duration.ofSeconds(environment.longValue("RELEASE_TRANSACTION_LEASE_SECONDS", 30, 5L..300L)),
                    readinessTimeout = Duration.ofSeconds(environment.longValue("RELEASE_READINESS_TIMEOUT_SECONDS", 180, 30L..900L)),
                    maxReleaseBytes = environment.longValue("RELEASE_MAX_BYTES", 67_108_864, 1L..268_435_456L)
                ),
                alipay = if (commercialFeatures.alipayEnabled) AlipayRuntimeConfig(
                    appId = environment.requiredValue("ALIPAY_APP_ID"),
                    sellerId = environment.requiredValue("ALIPAY_SELLER_ID"),
                    gateway = URI(environment.value("ALIPAY_GATEWAY") ?: "https://openapi.alipay.com/gateway.do"),
                    privateKey = environment.requiredValue("ALIPAY_PRIVATE_KEY"),
                    publicKey = environment.requiredValue("ALIPAY_PUBLIC_KEY"),
                    notifyUrl = environment.requiredValue("ALIPAY_NOTIFY_URL"),
                    returnUrl = environment.value("ALIPAY_RETURN_URL")
                ) else null,
                aiProvider = if (commercialFeatures.aiWorkbenchEnabled) AiProviderRuntimeConfig(
                    providerId = environment.value("AI_PROVIDER_ID") ?: "default",
                    baseUrl = URI(environment.value("AI_PROVIDER_BASE_URL") ?: "https://api.openai.com/v1"),
                    apiKey = environment.requiredValue("AI_PROVIDER_API_KEY"),
                    model = environment.requiredValue("AI_PROVIDER_MODEL"),
                    requestTimeout = Duration.ofSeconds(environment.longValue("AI_PROVIDER_REQUEST_TIMEOUT_SECONDS", 60, 1L..300L)),
                    maxResponseBytes = environment.longValue("AI_PROVIDER_MAX_RESPONSE_BYTES", 2L * 1024 * 1024, 1L..16L * 1024 * 1024),
                    inputCostPerMillionCents = environment.longValue("AI_INPUT_COST_PER_MILLION_CENTS", 0, 0L..1_000_000_000L),
                    outputCostPerMillionCents = environment.longValue("AI_OUTPUT_COST_PER_MILLION_CENTS", 0, 0L..1_000_000_000L),
                    usageReservationCents = environment.longValue("AI_USAGE_RESERVATION_CENTS", 100, 0L..1_000_000L)
                ) else null,
                runner = if (commercialFeatures.runnerEnabled) RunnerRuntimeConfig(
                    endpoint = URI(environment.value("RUNNER_ENDPOINT") ?: "http://127.0.0.1:9781/v1/run"),
                    sharedSecret = environment.requiredValue("RUNNER_SHARED_SECRET"),
                    requestTimeout = Duration.ofSeconds(environment.longValue("RUNNER_REQUEST_TIMEOUT_SECONDS", 60, 1L..300L)),
                    maxResponseBytes = environment.longValue("RUNNER_MAX_RESPONSE_BYTES", 4L * 1024 * 1024, 1L..16L * 1024 * 1024)
                ) else null,
                updates = UpdateConfig.fromEnvironment(environment),
                ketherDocs = KetherDocsConfig.fromEnvironment(environment),
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

private fun Map<String, String>.requiredValue(name: String): String =
    value(name) ?: throw IllegalArgumentException("$name 不能为空")

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

private fun Map<String, String>.booleanValue(name: String, default: Boolean): Boolean {
    val raw = value(name) ?: return default
    return raw.toBooleanStrictOrNull() ?: throw IllegalArgumentException("$name 必须是 true 或 false")
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
