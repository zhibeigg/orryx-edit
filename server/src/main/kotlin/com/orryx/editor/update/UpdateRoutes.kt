package com.orryx.editor.update

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
private data class UpdateApiError(val code: String, val message: String = code)

fun Route.updateAdminRoutes(
    service: UpdateService,
    authorize: suspend (ApplicationCall) -> Boolean
) {
    route("/update") {
        get("/status") {
            if (!authorize(call)) return@get
            call.respond(service.overview())
        }
        get("/jobs/{id}") {
            if (!authorize(call)) return@get
            val job = call.parameters["id"]?.let { service.getJob(it) }
            if (job == null) call.respond(HttpStatusCode.NotFound, UpdateApiError("UPDATE_JOB_NOT_FOUND"))
            else call.respond(job)
        }
        post("/jobs") {
            if (!authorize(call)) return@post
            try {
                call.respond(HttpStatusCode.Accepted, service.start(call.receive<StartUpdateRequest>()))
            } catch (failure: UpdateFailure) {
                val status = when (failure.code) {
                    UpdateErrorCode.UPDATE_IN_PROGRESS -> HttpStatusCode.Conflict
                    UpdateErrorCode.ACTIVE_USERS -> HttpStatusCode.Conflict
                    UpdateErrorCode.APPLY_NOT_SUPPORTED -> HttpStatusCode.UnprocessableEntity
                    else -> HttpStatusCode.BadRequest
                }
                call.respond(status, UpdateApiError(failure.code))
            }
        }
    }
}
