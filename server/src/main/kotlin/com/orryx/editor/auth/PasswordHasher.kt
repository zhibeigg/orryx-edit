package com.orryx.editor.auth

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

interface PasswordHasher {
    fun hash(password: CharArray): String
    fun verify(password: CharArray, encodedHash: String): Boolean
}

class Argon2idPasswordHasher(
    private val memoryKb: Int = 65_536,
    private val iterations: Int = 3,
    private val parallelism: Int = 1,
    private val saltLength: Int = 16,
    private val hashLength: Int = 32,
    private val secureRandom: SecureRandom = SecureRandom()
) : PasswordHasher {
    init {
        require(memoryKb in 8 * parallelism..1_048_576) { "invalid Argon2 memory cost" }
        require(iterations in 1..10) { "invalid Argon2 iteration count" }
        require(parallelism in 1..16) { "invalid Argon2 parallelism" }
        require(saltLength in 16..64) { "invalid salt length" }
        require(hashLength in 16..64) { "invalid hash length" }
    }

    override fun hash(password: CharArray): String {
        require(password.size in 8..1024) { "password length must be between 8 and 1024" }
        val salt = ByteArray(saltLength).also(secureRandom::nextBytes)
        val result = derive(password, salt, memoryKb, iterations, parallelism, hashLength)
        return try {
            val encoder = Base64.getEncoder().withoutPadding()
            "\$argon2id\$v=19\$m=$memoryKb,t=$iterations,p=$parallelism\$${encoder.encodeToString(salt)}\$${encoder.encodeToString(result)}"
        } finally {
            result.fill(0)
            salt.fill(0)
        }
    }

    override fun verify(password: CharArray, encodedHash: String): Boolean {
        if (password.size !in 1..1024 || encodedHash.length !in 40..512) return false
        val parsed = runCatching { parse(encodedHash) }.getOrNull() ?: return false
        if (parsed.memoryKb !in 8 * parsed.parallelism..1_048_576) return false
        if (parsed.iterations !in 1..10 || parsed.parallelism !in 1..16) return false
        if (parsed.salt.size !in 16..64 || parsed.hash.size !in 16..64) return false
        val actual = derive(
            password = password,
            salt = parsed.salt,
            memoryKb = parsed.memoryKb,
            iterations = parsed.iterations,
            parallelism = parsed.parallelism,
            outputLength = parsed.hash.size
        )
        return try {
            MessageDigest.isEqual(parsed.hash, actual)
        } finally {
            actual.fill(0)
            parsed.hash.fill(0)
            parsed.salt.fill(0)
        }
    }

    private fun derive(
        password: CharArray,
        salt: ByteArray,
        memoryKb: Int,
        iterations: Int,
        parallelism: Int,
        outputLength: Int
    ): ByteArray {
        val passwordBytes = password.concatToString().toByteArray(Charsets.UTF_8)
        return try {
            val parameters = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withMemoryAsKB(memoryKb)
                .withIterations(iterations)
                .withParallelism(parallelism)
                .withSalt(salt)
                .build()
            val generator = Argon2BytesGenerator()
            generator.init(parameters)
            ByteArray(outputLength).also { generator.generateBytes(passwordBytes, it) }
        } finally {
            passwordBytes.fill(0)
        }
    }

    private fun parse(value: String): ParsedHash {
        val parts = value.split('$')
        require(parts.size == 6 && parts[0].isEmpty() && parts[1] == "argon2id" && parts[2] == "v=19")
        val parameters = parts[3].split(',').associate { item ->
            val pair = item.split('=', limit = 2)
            require(pair.size == 2)
            pair[0] to pair[1].toInt()
        }
        require(parameters.keys == setOf("m", "t", "p"))
        val decoder = Base64.getDecoder()
        return ParsedHash(
            memoryKb = parameters.getValue("m"),
            iterations = parameters.getValue("t"),
            parallelism = parameters.getValue("p"),
            salt = decoder.decode(parts[4]),
            hash = decoder.decode(parts[5])
        )
    }

    private data class ParsedHash(
        val memoryKb: Int,
        val iterations: Int,
        val parallelism: Int,
        val salt: ByteArray,
        val hash: ByteArray
    )
}
