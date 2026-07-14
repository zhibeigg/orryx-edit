package com.orryx.editor.auth

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant
import java.util.Locale

object InstantIsoSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
}

@Serializable
enum class AccountStatus {
    ACTIVE,
    SUSPENDED,
    DISABLED
}

@Serializable
data class Account(
    val id: String,
    val email: String,
    val emailNormalized: String,
    val displayName: String,
    val status: AccountStatus,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val updatedAt: Instant
)

data class StoredAccount(
    val account: Account,
    val passwordHash: String
)

@Serializable
data class RegisterAccountCommand(
    val email: String,
    val password: String,
    val displayName: String
) {
    init {
        require(password.length in 8..1024) { "password length must be between 8 and 1024" }
        require(displayName.trim().length in 1..80) { "displayName length must be between 1 and 80" }
    }
}

object EmailAddress {
    private const val MAX_EMAIL_LENGTH = 254
    private const val MAX_LOCAL_LENGTH = 64

    fun normalize(value: String): String {
        val normalized = value.trim().lowercase(Locale.ROOT)
        require(normalized.length in 3..MAX_EMAIL_LENGTH) { "invalid email length" }
        require(normalized.count { it == '@' } == 1) { "invalid email format" }
        val local = normalized.substringBefore('@')
        val domain = normalized.substringAfter('@')
        require(local.length in 1..MAX_LOCAL_LENGTH && isValidLocal(local)) { "invalid email local part" }
        require(isValidDomain(domain)) { "invalid email domain" }
        return normalized
    }

    private fun isValidLocal(local: String): Boolean {
        if (local.startsWith('.') || local.endsWith('.') || ".." in local) return false
        return local.all { character ->
            character.isLetterOrDigit() || character in ".!#$%&'*+-/=?^_`{|}~"
        }
    }

    private fun isValidDomain(domain: String): Boolean {
        if (domain.length !in 3..253 || domain.startsWith('.') || domain.endsWith('.')) return false
        val labels = domain.split('.')
        if (labels.size < 2) return false
        return labels.all { label ->
            label.length in 1..63 &&
                label.first().isLetterOrDigit() &&
                label.last().isLetterOrDigit() &&
                label.all { it.isLetterOrDigit() || it == '-' }
        }
    }
}

@Serializable
data class SessionView(
    val id: String,
    val accountId: String,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val lastSeenAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val expiresAt: Instant,
    val rotatedFromId: String? = null,
    @Serializable(with = InstantIsoSerializer::class)
    val revokedAt: Instant? = null
)

data class SessionRecord(
    val view: SessionView,
    val tokenHash: String,
    val csrfTokenHash: String
)

@Serializable
data class IssuedSession(
    val token: String,
    val csrfToken: String,
    val session: SessionView
)
