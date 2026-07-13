package com.orryx.editor.ketherdocs

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class BundledKetherDocsLoader(
    private val validator: KetherDocsValidator,
    private val classLoader: ClassLoader = BundledKetherDocsLoader::class.java.classLoader
) {
    suspend fun load(): ActiveKetherDocs? {
        val bytes = try {
            withContext(Dispatchers.IO) {
                classLoader.getResourceAsStream("static/actions-schema.json")?.use { it.readBytes() }
            }
        } catch (failure: CancellationException) {
            throw failure
        } catch (_: Throwable) {
            throw KetherDocsFailure(KetherDocsErrorCode.CACHE_INVALID)
        } ?: return null
        return validator.validateBundled(bytes)
    }
}
