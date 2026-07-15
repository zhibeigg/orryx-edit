package com.orryx.editor.relay

import com.orryx.editor.protocol.ProtocolLimits

internal object RelayValidation {
    private val serverIdPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val capabilityPattern = Regex("^[a-z][a-z0-9._-]{0,63}$")
    private val sha256Pattern = Regex("^[0-9a-f]{64}$")

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

    fun pluginVersion(value: String): String? = value.trim().takeIf {
        it.isNotEmpty() &&
            it.length <= ProtocolLimits.MAX_PLUGIN_VERSION_LENGTH &&
            it.none(Char::isISOControl)
    }

    fun capability(value: String): String? = value.takeIf {
        it.length <= ProtocolLimits.MAX_CAPABILITY_LENGTH && capabilityPattern.matches(it)
    }

    fun connectionNonce(value: String): String? = value.takeIf {
        it.length in ProtocolLimits.MIN_TOKEN_LENGTH..ProtocolLimits.MAX_CONNECTION_NONCE_LENGTH &&
            it.none(Char::isWhitespace) &&
            it.none(Char::isISOControl)
    }

    fun sha256Revision(value: String): String? = value.takeIf(sha256Pattern::matches)

    fun manifestId(value: String): String? = value.takeIf {
        it.isNotEmpty() &&
            it.length <= ProtocolLimits.MAX_MANIFEST_ID_LENGTH &&
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
