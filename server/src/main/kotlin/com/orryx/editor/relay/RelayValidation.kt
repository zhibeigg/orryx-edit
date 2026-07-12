package com.orryx.editor.relay

import com.orryx.editor.protocol.ProtocolLimits

internal object RelayValidation {
    private val serverIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

    fun serverName(value: String): String? = value.trim().takeIf {
        it.isNotEmpty() &&
            it.length <= ProtocolLimits.MAX_SERVER_NAME_LENGTH &&
            it.none(Char::isISOControl)
    }

    fun serverId(value: String): String? = value.trim().takeIf {
        it.length <= ProtocolLimits.MAX_SERVER_ID_LENGTH && serverIdPattern.matches(it)
    }

    fun token(value: String): String? = value.takeIf {
        it.length in ProtocolLimits.MIN_TOKEN_LENGTH..ProtocolLimits.MAX_TOKEN_LENGTH &&
            it.none(Char::isWhitespace) &&
            it.none(Char::isISOControl)
    }

    fun playerName(value: String): String? = value.trim().takeIf {
        it.isNotEmpty() &&
            it.length <= ProtocolLimits.MAX_PLAYER_NAME_LENGTH &&
            it.none(Char::isISOControl)
    }

    fun browserId(value: String): String? = value.takeIf {
        it.isNotEmpty() &&
            it.length <= ProtocolLimits.MAX_BROWSER_ID_LENGTH &&
            it.none(Char::isWhitespace) &&
            it.none(Char::isISOControl)
    }

    fun path(value: String): String? {
        if (value.isEmpty() || value.length > ProtocolLimits.MAX_PATH_LENGTH || value.any(Char::isISOControl)) return null
        val normalized = value.replace('\\', '/').removePrefix("/")
        if (normalized.isEmpty()) return null
        val segments = normalized.split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." }) return null
        return normalized
    }
}
