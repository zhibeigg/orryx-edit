package com.orryx.editor.release

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object ReleaseTransferToken {
    fun hash(rawToken: String): String {
        require(rawToken.isNotBlank()) { "transfer token 不能为空" }
        val bytes = rawToken.toByteArray(StandardCharsets.UTF_8)
        return try {
            MessageDigest.getInstance("SHA-256").digest(bytes).toHex()
        } finally {
            bytes.fill(0)
        }
    }
}
