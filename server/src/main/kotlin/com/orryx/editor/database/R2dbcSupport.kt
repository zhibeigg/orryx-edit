package com.orryx.editor.database

import io.r2dbc.spi.Connection
import io.r2dbc.spi.Row
import io.r2dbc.spi.RowMetadata
import io.r2dbc.spi.Statement
import kotlinx.coroutines.reactive.awaitSingle
import reactor.core.publisher.Flux
import java.time.Instant

suspend fun Connection.executeFully(sql: String): Long = executeFully(createStatement(sql))

suspend fun executeFully(statement: Statement): Long = Flux.from(statement.execute())
    .concatMap { result -> result.rowsUpdated }
    .reduce(0L, Long::plus)
    .awaitSingle()

suspend fun <T> queryAll(statement: Statement, mapper: (Row, RowMetadata) -> T): List<T> =
    Flux.from(statement.execute())
        .concatMap { result -> result.map(mapper) }
        .collectList()
        .awaitSingle()

suspend fun <T> queryOne(statement: Statement, mapper: (Row, RowMetadata) -> T): T? =
    queryAll(statement, mapper).singleOrNull()

fun Statement.bindNullable(index: Int, value: String?): Statement =
    if (value == null) bindNull(index, String::class.java) else bind(index, value)

fun Statement.bindNullable(index: Int, value: Instant?): Statement =
    if (value == null) bindNull(index, Instant::class.java) else bind(index, value)
