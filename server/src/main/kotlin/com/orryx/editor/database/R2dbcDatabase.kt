package com.orryx.editor.database

import com.orryx.editor.config.DatabaseConfig
import io.r2dbc.pool.ConnectionPool
import io.r2dbc.pool.ConnectionPoolConfiguration
import io.r2dbc.spi.Connection
import io.r2dbc.spi.ConnectionFactories
import io.r2dbc.spi.ConnectionFactoryOptions
import io.r2dbc.spi.Option
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.reactive.awaitFirstOrNull
import kotlinx.coroutines.reactive.awaitSingle
import kotlinx.coroutines.withContext
import java.time.Duration

class R2dbcDatabase private constructor(private val pool: ConnectionPool) : AutoCloseable {
    companion object {
        fun create(config: DatabaseConfig): R2dbcDatabase {
            var options = ConnectionFactoryOptions.parse(config.url).mutate()
            config.user?.let { options = options.option(ConnectionFactoryOptions.USER, it) }
            config.password?.let { options = options.option(ConnectionFactoryOptions.PASSWORD, it) }
            options = options
                .option(Option.valueOf("connectTimeout"), config.acquireTimeout)
                .option(Option.valueOf("statementTimeout"), config.statementTimeout)
            val connectionFactory = ConnectionFactories.get(options.build())
            val poolConfig = ConnectionPoolConfiguration.builder(connectionFactory)
                .initialSize(config.initialPoolSize)
                .maxSize(config.maxPoolSize)
                .maxAcquireTime(config.acquireTimeout)
                .maxIdleTime(config.idleTimeout)
                .validationQuery("SELECT 1")
                .build()
            return R2dbcDatabase(ConnectionPool(poolConfig))
        }
    }

    suspend fun <T> withConnection(block: suspend (Connection) -> T): T {
        val connection = pool.create().awaitSingle()
        try {
            return block(connection)
        } finally {
            withContext(NonCancellable) { connection.close().awaitFirstOrNull() }
        }
    }

    suspend fun <T> inTransaction(block: suspend (Connection) -> T): T = withConnection { connection ->
        connection.beginTransaction().awaitFirstOrNull()
        try {
            val value = block(connection)
            connection.commitTransaction().awaitFirstOrNull()
            value
        } catch (failure: Throwable) {
            withContext(NonCancellable) {
                runCatching { connection.rollbackTransaction().awaitFirstOrNull() }
                    .onFailure(failure::addSuppressed)
            }
            throw failure
        }
    }

    suspend fun warmUp(): Int = pool.warmup().awaitSingle()

    suspend fun ping(): Boolean = runCatching {
        withConnection { connection ->
            queryOne(connection.createStatement("SELECT 1")) { _, _ -> true } ?: false
        }
    }.getOrDefault(false)

    suspend fun closeAsync() {
        withContext(NonCancellable) { pool.disposeLater().awaitFirstOrNull() }
    }

    @Deprecated("生产生命周期必须使用 closeAsync() 等待连接池释放")
    override fun close() {
        pool.dispose()
    }
}
