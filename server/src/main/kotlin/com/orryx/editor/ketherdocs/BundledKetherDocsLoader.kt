package com.orryx.editor.ketherdocs

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class BundledKetherDocsLoader(
    private val validator: KetherDocsValidator,
    private val classLoader: ClassLoader = BundledKetherDocsLoader::class.java.classLoader
) {
    suspend fun load(): ActiveKetherDocs? {
        val documents = try {
            withContext(Dispatchers.IO) {
                val registry = classLoader.getResourceAsStream("static/kether-registry.json")?.use { it.readBytes() }
                val legacy = classLoader.getResourceAsStream("static/actions-schema.json")?.use { it.readBytes() }
                registry to legacy
            }
        } catch (failure: CancellationException) {
            throw failure
        } catch (_: Throwable) {
            throw KetherDocsFailure(KetherDocsErrorCode.CACHE_INVALID)
        }
        val primary = documents.first ?: documents.second ?: return null
        val legacy = documents.second?.takeUnless { it.contentEquals(primary) }
        return validator.validateBundled(primary, legacy)
    }
}
