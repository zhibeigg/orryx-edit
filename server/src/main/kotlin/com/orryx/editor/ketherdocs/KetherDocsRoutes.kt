package com.orryx.editor.ketherdocs

import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
private data class KetherDocsApiError(val code: String, val message: String = code)

internal fun Route.ketherDocsAdminRoutes(
    service: KetherDocsService,
    authorize: suspend (ApplicationCall) -> Boolean
) {
    route("/kether-docs") {
        get("/status") {
            if (!authorize(call)) return@get
            call.respond(service.status())
        }
        post("/sync") {
            if (!authorize(call)) return@post
            call.respond(service.synchronize())
        }
    }
}

internal suspend fun ApplicationCall.respondKetherDocsSchema(service: KetherDocsService) {
    val schema = service.currentSchema()
    if (schema == null) {
        respond(
            HttpStatusCode.ServiceUnavailable,
            KetherDocsApiError(KetherDocsErrorCode.NO_USABLE_SCHEMA, "当前没有可用的 Kether Actions Schema")
        )
        return
    }

    val etag = "\"${schema.sha256}\""
    response.headers.append(HttpHeaders.ETag, etag)
    response.headers.append(HttpHeaders.CacheControl, "public, max-age=300, stale-while-revalidate=86400")
    response.headers.append("X-Orryx-Kether-Source", schema.source.name.lowercase())
    schema.releaseId?.let { response.headers.append("X-Orryx-Kether-Release", it) }
    if (request.header(HttpHeaders.IfNoneMatch) == etag) {
        respond(HttpStatusCode.NotModified)
        return
    }
    respondBytes(schema.bytes, ContentType.Application.Json, HttpStatusCode.OK)
}
