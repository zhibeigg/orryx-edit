package com.orryx.editor.update

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path

class UpdateStartupReconciler(
    private val updateDirectory: Path,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    suspend fun reconcile(): UpdateManifest? = withContext(Dispatchers.IO) {
        val pending = updateDirectory.resolve("pending-update.json")
        if (!Files.isRegularFile(pending)) return@withContext null
        val manifest = runCatching { json.decodeFromString<UpdateManifest>(Files.readString(pending)) }.getOrNull()
            ?: return@withContext null
        if (SemVer.parse(manifest.version) == null || manifest.artifact.contains('/') || manifest.artifact.contains('\\')) {
            return@withContext null
        }
        val staged = updateDirectory.resolve("staged").resolve(manifest.artifact).normalize()
        if (!staged.startsWith(updateDirectory.resolve("staged").normalize()) || !Files.isRegularFile(staged)) null else manifest
    }
}
