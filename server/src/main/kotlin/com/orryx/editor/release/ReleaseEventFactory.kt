package com.orryx.editor.release

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

object ReleaseEventFactory {
    fun create(
        transactionId: UUID,
        sequence: Long,
        eventKey: String,
        eventType: String,
        payload: String,
        createdAt: Instant
    ): ReleaseEvent {
        require(sequence > 0) { "sequence 必须大于 0" }
        require(eventKey.isNotBlank() && eventKey.length <= 128) { "eventKey 长度无效" }
        require(eventType.isNotBlank() && eventType.length <= 64) { "eventType 长度无效" }
        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(payload.toByteArray(StandardCharsets.UTF_8))
            .toHex()
        return ReleaseEvent(transactionId, sequence, eventKey, eventType, payload, fingerprint, createdAt)
    }
}
