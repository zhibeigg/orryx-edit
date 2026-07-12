package com.orryx.editor.session

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object ResumeTokenHash {
    fun sha256(token: String): String {
        require(token.isNotBlank()) { "resume token 不能为空" }
        return MessageDigest.getInstance("SHA-256")
            .digest(token.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
