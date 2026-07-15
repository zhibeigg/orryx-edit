package com.orryx.editor.draft

import com.orryx.editor.ai.AiJobErrorCode
import com.orryx.editor.ai.DraftArtifactException
import com.orryx.editor.ai.DraftArtifactRequest
import com.orryx.editor.ai.DraftArtifactResult
import com.orryx.editor.ai.DraftArtifactSink
import com.orryx.editor.versioning.AppendVersionResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

class DraftArtifactSinkAdapter(
    private val drafts: DraftService,
    private val json: Json = Json { prettyPrint = true }
) : DraftArtifactSink {
    override suspend fun store(request: DraftArtifactRequest): DraftArtifactResult {
        val draftId = request.draftId ?: throw DraftArtifactException()
        val draft = drafts.get(draftId) ?: throw DraftArtifactException()
        if (draft.accountId != request.accountId.toString() || draft.serverInstanceId != request.serverInstanceId.toString()) {
            throw DraftArtifactException(AiJobErrorCode.ACCESS_DENIED)
        }
        val expectedVersion = request.baseVersionId?.let { baseVersionId ->
            val base = drafts.getVersion(baseVersionId) ?: throw DraftArtifactException()
            if (base.version.draftId != draftId) throw DraftArtifactException()
            base.version.versionNumber
        } ?: draft.currentVersion
        if (expectedVersion != draft.currentVersion) throw DraftArtifactException(AiJobErrorCode.ARTIFACT_FAILED)

        val result = drafts.appendAiArtifacts(
            draftId = draftId,
            expectedVersion = expectedVersion,
            authorAccountId = request.accountId.toString(),
            files = extractArtifacts(request)
        )
        return when (result) {
            is AppendVersionResult.Created -> DraftArtifactResult(result.stored.version.id.toString())
            is AppendVersionResult.Conflict,
            AppendVersionResult.DraftArchived,
            AppendVersionResult.DraftNotFound -> throw DraftArtifactException()
        }
    }

    private fun extractArtifacts(request: DraftArtifactRequest): List<AiDraftArtifact> {
        val objectValue = request.artifact as? JsonObject
        val files = (objectValue?.get("files") ?: objectValue?.get("artifacts")) as? JsonArray
        if (files != null) {
            val parsed = files.map { element -> parseFile(element) }
            if (parsed.isNotEmpty()) return parsed
        }
        return listOf(
            AiDraftArtifact(
                path = "orryx/ai/${request.operation.name.lowercase()}-${request.jobId}.json",
                content = json.encodeToString(JsonElement.serializer(), request.artifact),
                baseRevision = null
            )
        )
    }

    private fun parseFile(element: JsonElement): AiDraftArtifact {
        val file = element as? JsonObject ?: throw DraftArtifactException()
        val path = file["path"]?.jsonPrimitive?.contentOrNull ?: throw DraftArtifactException()
        val content = file["content"]?.jsonPrimitive?.contentOrNull ?: throw DraftArtifactException()
        val baseRevision = file["baseRevision"]?.jsonPrimitive?.contentOrNull
        return AiDraftArtifact(path, content, baseRevision)
    }
}
