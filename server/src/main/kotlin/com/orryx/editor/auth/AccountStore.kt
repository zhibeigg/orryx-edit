package com.orryx.editor.auth

import com.orryx.editor.database.R2dbcDatabase
import com.orryx.editor.database.executeFully
import com.orryx.editor.database.queryOne
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

interface AccountStore {
    suspend fun create(account: Account, passwordHash: String): Boolean
    suspend fun findById(accountId: String): Account?
    suspend fun findByNormalizedEmail(emailNormalized: String): StoredAccount?
    suspend fun updateStatus(accountId: String, status: AccountStatus, updatedAt: Instant): Account?
}

class InMemoryAccountStore : AccountStore {
    private val mutex = Mutex()
    private val accounts = linkedMapOf<String, StoredAccount>()
    private val accountIdByEmail = mutableMapOf<String, String>()

    override suspend fun create(account: Account, passwordHash: String): Boolean = mutex.withLock {
        if (account.id in accounts || account.emailNormalized in accountIdByEmail) return@withLock false
        accounts[account.id] = StoredAccount(account, passwordHash)
        accountIdByEmail[account.emailNormalized] = account.id
        true
    }

    override suspend fun findById(accountId: String): Account? = mutex.withLock {
        accounts[accountId]?.account
    }

    override suspend fun findByNormalizedEmail(emailNormalized: String): StoredAccount? = mutex.withLock {
        accountIdByEmail[emailNormalized]?.let(accounts::get)
    }

    override suspend fun updateStatus(accountId: String, status: AccountStatus, updatedAt: Instant): Account? = mutex.withLock {
        val stored = accounts[accountId] ?: return@withLock null
        val updated = stored.account.copy(status = status, updatedAt = updatedAt)
        accounts[accountId] = stored.copy(account = updated)
        updated
    }
}

class PostgresAccountStore(private val database: R2dbcDatabase) : AccountStore {
    override suspend fun create(account: Account, passwordHash: String): Boolean = database.withConnection { connection ->
        executeFully(
            connection.createStatement(
                """
                INSERT INTO commercial_accounts(
                    account_id, email, email_normalized, password_hash, display_name, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                """.trimIndent()
            )
                .bind(0, UUID.fromString(account.id))
                .bind(1, account.email)
                .bind(2, account.emailNormalized)
                .bind(3, passwordHash)
                .bind(4, account.displayName)
                .bind(5, account.status.name)
                .bind(6, account.createdAt)
                .bind(7, account.updatedAt)
        ) == 1L
    }

    override suspend fun findById(accountId: String): Account? = database.withConnection { connection ->
        queryOne(
            connection.createStatement("SELECT * FROM commercial_accounts WHERE account_id = $1")
                .bind(0, UUID.fromString(accountId))
        ) { row, _ ->
            Account(
                id = row.get("account_id", UUID::class.java)!!.toString(),
                email = row.get("email", String::class.java)!!,
                emailNormalized = row.get("email_normalized", String::class.java)!!,
                displayName = row.get("display_name", String::class.java)!!,
                status = AccountStatus.valueOf(row.get("status", String::class.java)!!),
                createdAt = row.get("created_at", Instant::class.java)!!,
                updatedAt = row.get("updated_at", Instant::class.java)!!
            )
        }
    }

    override suspend fun findByNormalizedEmail(emailNormalized: String): StoredAccount? =
        database.withConnection { connection ->
            queryOne(
                connection.createStatement("SELECT * FROM commercial_accounts WHERE email_normalized = $1")
                    .bind(0, emailNormalized)
            ) { row, _ ->
                StoredAccount(
                    account = Account(
                        id = row.get("account_id", UUID::class.java)!!.toString(),
                        email = row.get("email", String::class.java)!!,
                        emailNormalized = row.get("email_normalized", String::class.java)!!,
                        displayName = row.get("display_name", String::class.java)!!,
                        status = AccountStatus.valueOf(row.get("status", String::class.java)!!),
                        createdAt = row.get("created_at", Instant::class.java)!!,
                        updatedAt = row.get("updated_at", Instant::class.java)!!
                    ),
                    passwordHash = row.get("password_hash", String::class.java)!!
                )
            }
        }

    override suspend fun updateStatus(accountId: String, status: AccountStatus, updatedAt: Instant): Account? =
        database.inTransaction { connection ->
            val updated = executeFully(
                connection.createStatement(
                    "UPDATE commercial_accounts SET status = $2, updated_at = $3 WHERE account_id = $1"
                )
                    .bind(0, UUID.fromString(accountId))
                    .bind(1, status.name)
                    .bind(2, updatedAt)
            )
            if (updated == 0L) null else queryOne(
                connection.createStatement("SELECT * FROM commercial_accounts WHERE account_id = $1")
                    .bind(0, UUID.fromString(accountId))
            ) { row, _ ->
                Account(
                    id = row.get("account_id", UUID::class.java)!!.toString(),
                    email = row.get("email", String::class.java)!!,
                    emailNormalized = row.get("email_normalized", String::class.java)!!,
                    displayName = row.get("display_name", String::class.java)!!,
                    status = AccountStatus.valueOf(row.get("status", String::class.java)!!),
                    createdAt = row.get("created_at", Instant::class.java)!!,
                    updatedAt = row.get("updated_at", Instant::class.java)!!
                )
            }
        }
}
