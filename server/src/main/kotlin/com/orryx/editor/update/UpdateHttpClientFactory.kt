package com.orryx.editor.update

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO

object UpdateHttpClientFactory {
    fun create(): HttpClient = HttpClient(CIO) {
        followRedirects = false
        expectSuccess = false
    }
}
