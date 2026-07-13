package com.orryx.editor.ketherdocs

import com.orryx.editor.database.sha256
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant

internal class KetherDocsValidator(private val config: KetherDocsConfig) {
    private val json = Json { ignoreUnknownKeys = true }
    private val versionPattern = Regex("^[0-9]+\\.[0-9]+\\.[0-9]+$")
    private val commitPattern = Regex("^[0-9a-f]{40}$")
    private val shaPattern = Regex("^[0-9a-f]{64}$")
    private val idPattern = Regex("^[a-z0-9]+(?:[._-][a-z0-9]+)*$")

    val channelUri: URI = config.baseUri.resolve("channels/${config.channel}.json")

    fun parseChannel(bytes: ByteArray): KetherChannelPointer = guarded(KetherDocsErrorCode.CHANNEL_INVALID) {
        val root = parseObject(bytes, KetherDocsErrorCode.CHANNEL_INVALID)
        ensure(root.requiredInt("formatVersion") == 1, KetherDocsErrorCode.CHANNEL_INVALID)
        ensure(root.requiredString("channel") == config.channel, KetherDocsErrorCode.CHANNEL_INVALID)
        val pluginVersion = root.requiredString("pluginVersion")
        val commit = root.requiredString("commit")
        val releaseId = root.requiredString("releaseId")
        ensure(versionPattern.matches(pluginVersion), KetherDocsErrorCode.CHANNEL_INVALID)
        ensure(commitPattern.matches(commit), KetherDocsErrorCode.CHANNEL_INVALID)
        ensure(releaseId == "Orryx@$pluginVersion+$commit", KetherDocsErrorCode.CHANNEL_INVALID)
        KetherChannelPointer(
            releaseId = releaseId,
            pluginVersion = pluginVersion,
            commit = commit,
            publishedAt = Instant.parse(root.requiredString("publishedAt")),
            releaseManifest = root.requiredString("releaseManifest")
        )
    }

    fun resolveManifestUri(pointer: KetherChannelPointer): URI {
        val safeVersion = pointer.pluginVersion.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val expectedPath = "${config.baseUri.path}releases/$safeVersion/${pointer.commit}/manifest.json"
        return resolveOfficial(pointer.releaseManifest, expectedPath)
    }

    fun parseReleaseManifest(bytes: ByteArray, pointer: KetherChannelPointer): KetherReleaseManifest =
        guarded(KetherDocsErrorCode.MANIFEST_INVALID) {
            val root = parseObject(bytes, KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(root.requiredInt("formatVersion") == 1, KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(root.requiredString("releaseId") == pointer.releaseId, KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(root.requiredString("channel") == config.channel, KetherDocsErrorCode.MANIFEST_INVALID)
            val plugin = root.requiredObject("plugin")
            ensure(plugin.requiredString("id") == "Orryx", KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(plugin.requiredString("version") == pointer.pluginVersion, KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(plugin.requiredString("commit") == pointer.commit, KetherDocsErrorCode.MANIFEST_INVALID)
            val schemaVersion = root.requiredInt("schemaVersion")
            ensure(schemaVersion == SUPPORTED_SCHEMA_VERSION, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
            val generatedAt = Instant.parse(root.requiredString("generatedAt"))
            ensure(generatedAt == pointer.publishedAt, KetherDocsErrorCode.MANIFEST_INVALID)
            val schema = root.requiredObject("assets").requiredObject("schema").toAsset()
            ensure(schema.path == "actions-schema.json", KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(schema.mediaType.substringBefore(';').trim() == "application/json", KetherDocsErrorCode.MANIFEST_INVALID)
            ensure(schema.bytes in 1..config.maxSchemaBytes, KetherDocsErrorCode.SCHEMA_TOO_LARGE)
            ensure(shaPattern.matches(schema.sha256), KetherDocsErrorCode.MANIFEST_INVALID)
            KetherReleaseManifest(
                releaseId = pointer.releaseId,
                pluginVersion = pointer.pluginVersion,
                commit = pointer.commit,
                schemaVersion = schemaVersion,
                generatedAt = generatedAt,
                previousReleaseId = root.optionalString("previousReleaseId"),
                schema = schema
            )
        }

    fun resolveSchemaUri(manifestUri: URI, manifest: KetherReleaseManifest): URI {
        val expectedPath = manifestUri.path.substringBeforeLast('/') + "/${manifest.schema.path}"
        return resolveOfficial(manifestUri.resolve(manifest.schema.path).toString(), expectedPath)
    }

    fun validateRemoteSchema(
        bytes: ByteArray,
        pointer: KetherChannelPointer,
        manifest: KetherReleaseManifest
    ): FetchedKetherDocs {
        ensure(bytes.size.toLong() == manifest.schema.bytes, KetherDocsErrorCode.SCHEMA_SIZE_MISMATCH)
        val digest = sha256(bytes)
        ensure(digest == manifest.schema.sha256, KetherDocsErrorCode.SCHEMA_CHECKSUM_INVALID)
        val parsed = validateSchemaDocument(
            bytes = bytes,
            expectedPluginVersion = pointer.pluginVersion,
            expectedCommit = pointer.commit,
            expectedSchemaVersion = manifest.schemaVersion
        )
        ensure(parsed.generatedAt == pointer.publishedAt, KetherDocsErrorCode.SCHEMA_INVALID)
        return FetchedKetherDocs(
            releaseId = pointer.releaseId,
            pluginVersion = parsed.pluginVersion,
            commit = parsed.commit,
            schemaVersion = parsed.schemaVersion,
            publishedAt = pointer.publishedAt,
            schemaSha256 = digest,
            schemaBytes = bytes
        )
    }

    fun validateCached(cache: CachedKetherDocs): ActiveKetherDocs = guarded(KetherDocsErrorCode.CACHE_INVALID) {
        ensure(cache.channel == config.channel, KetherDocsErrorCode.CACHE_INVALID)
        ensure(cache.releaseId == "Orryx@${cache.pluginVersion}+${cache.commit}", KetherDocsErrorCode.CACHE_INVALID)
        ensure(versionPattern.matches(cache.pluginVersion), KetherDocsErrorCode.CACHE_INVALID)
        ensure(commitPattern.matches(cache.commit), KetherDocsErrorCode.CACHE_INVALID)
        val bytes = cache.schemaJson.toByteArray(Charsets.UTF_8)
        ensure(bytes.size.toLong() == cache.schemaBytes, KetherDocsErrorCode.CACHE_INVALID)
        ensure(sha256(bytes) == cache.schemaSha256, KetherDocsErrorCode.CACHE_INVALID)
        validateSchemaDocument(bytes, cache.pluginVersion, cache.commit, cache.schemaVersion)
        ActiveKetherDocs(
            source = KetherDocsSource.CACHE,
            releaseId = cache.releaseId,
            pluginVersion = cache.pluginVersion,
            commit = cache.commit,
            schemaVersion = cache.schemaVersion,
            schemaSha256 = cache.schemaSha256,
            schemaBytes = bytes,
            publishedAt = cache.publishedAt,
            syncedAt = cache.syncedAt
        )
    }

    fun validateBundled(bytes: ByteArray): ActiveKetherDocs = guarded(KetherDocsErrorCode.CACHE_INVALID) {
        val parsed = validateSchemaDocument(bytes, expectedSchemaVersion = SUPPORTED_SCHEMA_VERSION)
        ActiveKetherDocs(
            source = KetherDocsSource.BUNDLED,
            releaseId = "Orryx@${parsed.pluginVersion}+${parsed.commit}",
            pluginVersion = parsed.pluginVersion,
            commit = parsed.commit,
            schemaVersion = parsed.schemaVersion,
            schemaSha256 = sha256(bytes),
            schemaBytes = bytes,
            publishedAt = parsed.generatedAt,
            syncedAt = null
        )
    }

    private fun validateSchemaDocument(
        bytes: ByteArray,
        expectedPluginVersion: String? = null,
        expectedCommit: String? = null,
        expectedSchemaVersion: Int
    ): ParsedSchema = guarded(KetherDocsErrorCode.SCHEMA_INVALID) {
        val root = parseObject(bytes, KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(
            root.requiredString("\$schema") == config.baseUri.resolve("contracts/actions-schema-v3.schema.json").toString(),
            KetherDocsErrorCode.SCHEMA_INVALID
        )
        ensure(root.requiredInt("version") == 2, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(root.requiredString("pluginId") == "Orryx", KetherDocsErrorCode.SCHEMA_INVALID)
        val schemaVersion = root.requiredInt("schemaVersion")
        ensure(schemaVersion == expectedSchemaVersion && schemaVersion == SUPPORTED_SCHEMA_VERSION, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        val pluginVersion = root.requiredString("pluginVersion")
        val commit = root.requiredString("commit")
        ensure(versionPattern.matches(pluginVersion), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(commitPattern.matches(commit), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedPluginVersion == null || pluginVersion == expectedPluginVersion, KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedCommit == null || commit == expectedCommit, KetherDocsErrorCode.SCHEMA_INVALID)

        val types = root.requiredObject("types")
        val categories = root.requiredObject("categories")
        ensure(types.isNotEmpty() && categories.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
        val ids = linkedSetOf<String>()

        validateItems(root.requiredArray("actions"), ids, requireNonEmpty = true) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("namespace").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(categories.containsKey(item.requiredString("category")), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("syntax").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            item.requiredArray("inputs").forEach { inputElement ->
                val input = inputElement.asObject()
                ensure(types.containsKey(input.requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input["required"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input.containsKey("default"), KetherDocsErrorCode.SCHEMA_INVALID)
            }
            when (val output = item["output"]) {
                null -> throw KetherDocsFailure(KetherDocsErrorCode.SCHEMA_INVALID)
                JsonNull -> Unit
                else -> ensure(types.containsKey(output.jsonObject.requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
            }
        }
        validateItems(root.requiredArray("selectors"), ids) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("syntax").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            item.requiredArray("params").forEach { param ->
                ensure(types.containsKey(param.asObject().requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
            }
        }
        validateItems(root.requiredArray("triggers"), ids) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            item["variables"]?.jsonArray?.forEach { variable ->
                ensure(types.containsKey(variable.asObject().requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
            }
        }
        validateItems(root.requiredArray("properties"), ids) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            item.requiredArray("keys").forEach { key ->
                ensure(types.containsKey(key.asObject().requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
            }
        }

        ParsedSchema(
            pluginVersion = pluginVersion,
            commit = commit,
            schemaVersion = schemaVersion,
            generatedAt = Instant.parse(root.requiredString("generatedAt"))
        )
    }

    private fun validateItems(
        items: JsonArray,
        ids: MutableSet<String>,
        requireNonEmpty: Boolean = false,
        validate: (JsonObject) -> Unit
    ) {
        if (requireNonEmpty) ensure(items.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
        items.forEach { element ->
            val item = element.asObject()
            val id = item.requiredString("id")
            ensure(idPattern.matches(id), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(ids.add(id), KetherDocsErrorCode.SCHEMA_INVALID)
            validate(item)
        }
    }

    private fun resolveOfficial(raw: String, expectedPath: String): URI {
        val uri = runCatching { config.baseUri.resolve(raw) }.getOrElse { throw KetherDocsFailure(KetherDocsErrorCode.URL_REJECTED) }
        ensure(uri.scheme == config.baseUri.scheme, KetherDocsErrorCode.URL_REJECTED)
        ensure(uri.host == config.baseUri.host && uri.port == config.baseUri.port, KetherDocsErrorCode.URL_REJECTED)
        ensure(uri.userInfo == null && uri.query == null && uri.fragment == null, KetherDocsErrorCode.URL_REJECTED)
        ensure(uri.rawPath == expectedPath, KetherDocsErrorCode.URL_REJECTED)
        return uri
    }

    private fun parseObject(bytes: ByteArray, code: String): JsonObject {
        val text = runCatching {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        }.getOrElse { throw KetherDocsFailure(code) }
        return runCatching { json.parseToJsonElement(text).jsonObject }
            .getOrElse { throw KetherDocsFailure(code) }
    }

    private fun JsonObject.requiredString(name: String): String = this[name]?.jsonPrimitive?.contentOrNull
        ?.takeIf(String::isNotBlank)
        ?: throw IllegalArgumentException("missing string: $name")

    private fun JsonObject.optionalString(name: String): String? {
        val value = this[name] ?: return null
        if (value is JsonNull) return null
        return value.jsonPrimitive.contentOrNull?.takeIf(String::isNotBlank)
    }

    private fun JsonObject.requiredInt(name: String): Int = this[name]?.jsonPrimitive?.intOrNull
        ?: throw IllegalArgumentException("missing integer: $name")

    private fun JsonObject.requiredObject(name: String): JsonObject = this[name]
        ?.let { runCatching { it.jsonObject }.getOrNull() }
        ?: throw IllegalArgumentException("missing object: $name")

    private fun JsonObject.requiredArray(name: String): JsonArray = this[name]
        ?.let { runCatching { it.jsonArray }.getOrNull() }
        ?: throw IllegalArgumentException("missing array: $name")

    private fun JsonElement.asObject(): JsonObject = runCatching { jsonObject }
        .getOrElse { throw IllegalArgumentException("expected object") }

    private fun JsonObject.toAsset(): KetherAsset = KetherAsset(
        path = requiredString("path"),
        mediaType = requiredString("mediaType"),
        bytes = this["bytes"]?.jsonPrimitive?.contentOrNull?.toLongOrNull()
            ?: throw KetherDocsFailure(KetherDocsErrorCode.MANIFEST_INVALID),
        sha256 = requiredString("sha256")
    )

    private fun <T> guarded(code: String, block: () -> T): T = try {
        block()
    } catch (failure: KetherDocsFailure) {
        throw failure
    } catch (_: Throwable) {
        throw KetherDocsFailure(code)
    }

    private fun ensure(condition: Boolean, code: String) {
        if (!condition) throw KetherDocsFailure(code)
    }

    private data class ParsedSchema(
        val pluginVersion: String,
        val commit: String,
        val schemaVersion: Int,
        val generatedAt: Instant
    )

    private companion object {
        const val SUPPORTED_SCHEMA_VERSION = 3
    }
}
