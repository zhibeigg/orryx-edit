package com.orryx.editor.auth

import java.time.Clock
import java.util.UUID

class AccountService(
    private val store: AccountStore,
    private val passwordHasher: PasswordHasher,
    private val clock: Clock = Clock.systemUTC(),
    private val accountIdGenerator: () -> String = { UUID.randomUUID().toString() }
) {
    suspend fun register(command: RegisterAccountCommand): Account {
        val normalizedEmail = EmailAddress.normalize(command.email)
        val now = clock.instant()
        val password = command.password.toCharArray()
        val passwordHash = try {
            passwordHasher.hash(password)
        } finally {
            password.fill('\u0000')
        }
        val account = Account(
            id = validateUuid(accountIdGenerator()),
            email = command.email.trim(),
            emailNormalized = normalizedEmail,
            displayName = command.displayName.trim(),
            status = AccountStatus.ACTIVE,
            createdAt = now,
            updatedAt = now
        )
        check(store.create(account, passwordHash)) { "email is already registered" }
        return account
    }

    suspend fun authenticate(email: String, passwordValue: String): Account? {
        if (passwordValue.length !in 1..1024) return null
        val normalized = runCatching { EmailAddress.normalize(email) }.getOrNull() ?: return null
        val stored = store.findByNormalizedEmail(normalized) ?: return null
        if (stored.account.status != AccountStatus.ACTIVE) return null
        val password = passwordValue.toCharArray()
        val valid = try {
            passwordHasher.verify(password, stored.passwordHash)
        } finally {
            password.fill('\u0000')
        }
        return stored.account.takeIf { valid }
    }

    suspend fun setStatus(accountId: String, status: AccountStatus): Account? =
        store.updateStatus(validateUuid(accountId), status, clock.instant())

    suspend fun find(accountId: String): Account? = store.findById(validateUuid(accountId))

    private fun validateUuid(value: String): String = UUID.fromString(value).toString()
}
