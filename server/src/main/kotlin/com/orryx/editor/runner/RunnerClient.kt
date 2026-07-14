package com.orryx.editor.runner

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

interface RunnerClient {
    suspend fun execute(request: RunnerRequest): RunnerResult
}

@Serializable
enum class RunnerOperation {
    @SerialName("generate") GENERATE,
    @SerialName("validate") VALIDATE,
    @SerialName("plan") PLAN
}

@Serializable
data class RunnerRequest(
    val requestId: String,
    val operation: RunnerOperation,
    val payload: JsonElement
)

@Serializable
data class ServiceRunnerEnvelope(
    val version: Int = 1,
    val requestId: String,
    val operation: RunnerOperation,
    val payload: JsonElement
)

@Serializable
data class RunnerResult(
    val requestId: String,
    val result: JsonElement,
    val requestEnvelope: JsonObject,
    val responseEnvelope: JsonObject
)

@Serializable
data class RunnerError(
    val code: String,
    val message: String? = null,
    val retryable: Boolean = false
)

class RunnerException(val error: RunnerError, cause: Throwable? = null) : RuntimeException(error.code, cause)

object RunnerPayloadGuard {
    fun requireSafe(payload: JsonElement) {
        inspect(payload, "$")
    }

    private fun inspect(element: JsonElement, path: String) {
        when (element) {
            is JsonObject -> element.forEach { (key, value) ->
                val normalized = key.lowercase().filter(Char::isLetterOrDigit)
                if (normalized in FORBIDDEN_KEYS) reject(path, key)
                if (normalized == "network" && containsAllow(value)) reject(path, key)
                if (normalized == "strict" && value is JsonPrimitive && value.booleanOrNull == false) reject(path, key)
                if (normalized in OPERATION_KEYS && value is JsonPrimitive) {
                    val operation = value.contentOrNull?.lowercase()?.filter(Char::isLetterOrDigit)
                    if (operation in FORBIDDEN_OPERATIONS) reject(path, key)
                }
                inspect(value, "$path.$key")
            }
            is JsonArray -> element.forEachIndexed { index, value -> inspect(value, "$path[$index]") }
            is JsonPrimitive -> Unit
        }
    }

    private fun containsAllow(element: JsonElement): Boolean = when (element) {
        is JsonPrimitive -> element.contentOrNull?.equals("allow", ignoreCase = true) == true
        is JsonArray -> element.any(::containsAllow)
        is JsonObject -> element.values.any(::containsAllow)
    }

    private fun reject(path: String, key: String): Nothing = throw RunnerException(
        RunnerError("RUNNER_UNSAFE_PAYLOAD", "禁止字段: $path.$key")
    )

    private val FORBIDDEN_KEYS = setOf(
        "materialize",
        "workspace",
        "actionsschema",
        "actionsschemapath",
        "reloadserver",
        "reload",
        "plugin",
        "filewrite",
        "command",
        "commands"
    )
    private val OPERATION_KEYS = setOf("operation", "action", "type", "method")
    private val FORBIDDEN_OPERATIONS = setOf("materialize", "filewrite", "reload", "reloadserver", "command", "executecommand")
}
