package com.orryx.editor.update

import io.ktor.http.Url

internal fun validateUpdateUrl(rawUrl: String, allowedHosts: Set<String>): Url {
    val url = runCatching { Url(rawUrl) }.getOrElse { throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED) }
    if (url.protocol.name != "https" || url.host.lowercase() !in allowedHosts || url.user != null || url.password != null) {
        throw UpdateFailure(UpdateErrorCode.REDIRECT_REJECTED)
    }
    return url
}
