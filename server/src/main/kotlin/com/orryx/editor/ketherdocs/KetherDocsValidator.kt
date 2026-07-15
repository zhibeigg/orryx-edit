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
            ensure(schemaVersion in SUPPORTED_SCHEMA_VERSIONS, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
            val registryVersion = root.optionalInt("registryVersion")
            ensure(registryVersion == null || registryVersion == 4, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
            val generatedAt = Instant.parse(root.requiredString("generatedAt"))
            ensure(generatedAt == pointer.publishedAt, KetherDocsErrorCode.MANIFEST_INVALID)
            val assets = root.requiredObject("assets")
            val schema = assets.requiredObject("schema").toAsset()
            validateAsset(schema, "actions-schema.json")
            val registry = assets.optionalObject("registry")?.toAsset()
            if (registryVersion != null) {
                validateAsset(registry ?: throw KetherDocsFailure(KetherDocsErrorCode.MANIFEST_INVALID), "kether-registry.json")
            }
            KetherReleaseManifest(
                releaseId = pointer.releaseId,
                pluginVersion = pointer.pluginVersion,
                commit = pointer.commit,
                schemaVersion = schemaVersion,
                registryVersion = registryVersion,
                generatedAt = generatedAt,
                previousReleaseId = root.optionalString("previousReleaseId"),
                schema = schema,
                registry = registry
            )
        }

    fun resolveSchemaUri(manifestUri: URI, manifest: KetherReleaseManifest): URI =
        resolveAssetUri(manifestUri, manifest.schema)

    fun resolveRegistryUri(manifestUri: URI, manifest: KetherReleaseManifest): URI? =
        manifest.registry?.let { resolveAssetUri(manifestUri, it) }

    private fun resolveAssetUri(manifestUri: URI, asset: KetherAsset): URI {
        val expectedPath = manifestUri.path.substringBeforeLast('/') + "/${asset.path}"
        return resolveOfficial(manifestUri.resolve(asset.path).toString(), expectedPath)
    }

    fun validateRemoteSchema(
        bytes: ByteArray,
        pointer: KetherChannelPointer,
        manifest: KetherReleaseManifest
    ): FetchedKetherDocs {
        val digest = validateAssetBytes(bytes, manifest.schema)
        val parsed = validateSchemaDocument(
            bytes = bytes,
            expectedPluginVersion = pointer.pluginVersion,
            expectedCommit = pointer.commit,
            expectedSchemaVersion = manifest.schemaVersion
        )
        return FetchedKetherDocs(
            releaseId = pointer.releaseId,
            pluginVersion = parsed.pluginVersion,
            commit = parsed.commit,
            schemaVersion = parsed.schemaVersion,
            publishedAt = pointer.publishedAt,
            schemaSha256 = digest,
            schemaBytes = bytes,
            legacySchemaSha256 = digest,
            legacySchemaBytes = bytes
        )
    }

    fun validateRemoteRegistry(
        registryBytes: ByteArray,
        legacySchemaBytes: ByteArray,
        pointer: KetherChannelPointer,
        manifest: KetherReleaseManifest
    ): FetchedKetherDocs {
        val registryAsset = manifest.registry ?: throw KetherDocsFailure(KetherDocsErrorCode.MANIFEST_INVALID)
        val registryDigest = validateAssetBytes(registryBytes, registryAsset)
        val legacyDigest = validateAssetBytes(legacySchemaBytes, manifest.schema)
        val registry = validateRegistryDocument(
            bytes = registryBytes,
            expectedPluginVersion = pointer.pluginVersion,
            expectedCommit = pointer.commit,
            expectedRegistryVersion = manifest.registryVersion ?: 4
        )
        validateSchemaDocument(
            bytes = legacySchemaBytes,
            expectedPluginVersion = pointer.pluginVersion,
            expectedCommit = pointer.commit,
            expectedSchemaVersion = manifest.schemaVersion
        )
        return FetchedKetherDocs(
            releaseId = pointer.releaseId,
            pluginVersion = registry.pluginVersion,
            commit = registry.commit,
            schemaVersion = registry.schemaVersion,
            publishedAt = pointer.publishedAt,
            schemaSha256 = registryDigest,
            schemaBytes = registryBytes,
            legacySchemaSha256 = legacyDigest,
            legacySchemaBytes = legacySchemaBytes
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
        validateDocument(bytes, cache.pluginVersion, cache.commit, cache.schemaVersion)
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

    fun validateBundled(bytes: ByteArray, legacySchemaBytes: ByteArray? = null): ActiveKetherDocs = guarded(KetherDocsErrorCode.CACHE_INVALID) {
        val parsed = validateDocument(bytes, expectedSchemaVersions = SUPPORTED_SCHEMA_VERSIONS)
        val legacyDigest = legacySchemaBytes?.let { legacy ->
            validateSchemaDocument(legacy, expectedSchemaVersion = 3)
            sha256(legacy)
        }
        ActiveKetherDocs(
            source = KetherDocsSource.BUNDLED,
            releaseId = "Orryx@${parsed.pluginVersion}+${parsed.commit}",
            pluginVersion = parsed.pluginVersion,
            commit = parsed.commit,
            schemaVersion = parsed.schemaVersion,
            schemaSha256 = sha256(bytes),
            schemaBytes = bytes,
            publishedAt = null,
            syncedAt = null,
            legacySchemaSha256 = legacyDigest,
            legacySchemaBytes = legacySchemaBytes
        )
    }

    private fun validateDocument(
        bytes: ByteArray,
        expectedPluginVersion: String? = null,
        expectedCommit: String? = null,
        expectedSchemaVersion: Int? = null,
        expectedSchemaVersions: Set<Int> = SUPPORTED_SCHEMA_VERSIONS
    ): ParsedSchema {
        val root = parseObject(bytes, KetherDocsErrorCode.SCHEMA_INVALID)
        return if (root["registryVersion"]?.jsonPrimitive?.intOrNull == 4) {
            validateRegistryDocument(bytes, expectedPluginVersion, expectedCommit, expectedSchemaVersion)
        } else {
            validateSchemaDocument(bytes, expectedPluginVersion, expectedCommit, expectedSchemaVersion, expectedSchemaVersions)
        }
    }

    private fun validateRegistryDocument(
        bytes: ByteArray,
        expectedPluginVersion: String? = null,
        expectedCommit: String? = null,
        expectedRegistryVersion: Int? = 4
    ): ParsedSchema = guarded(KetherDocsErrorCode.SCHEMA_INVALID) {
        val root = parseObject(bytes, KetherDocsErrorCode.SCHEMA_INVALID)
        val registryVersion = root.requiredInt("registryVersion")
        ensure(registryVersion == 4, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(expectedRegistryVersion == null || registryVersion == expectedRegistryVersion, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(root.requiredInt("schemaVersion") == registryVersion, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(
            root.requiredString("\$schema") == config.baseUri.resolve("contracts/kether-registry-v4.schema.json").toString(),
            KetherDocsErrorCode.SCHEMA_INVALID
        )
        ensure(root.requiredString("pluginId") == "Orryx", KetherDocsErrorCode.SCHEMA_INVALID)
        val pluginVersion = root.requiredString("pluginVersion")
        val commit = root.requiredString("commit")
        ensure(versionPattern.matches(pluginVersion), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(commitPattern.matches(commit), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedPluginVersion == null || pluginVersion == expectedPluginVersion, KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedCommit == null || commit == expectedCommit, KetherDocsErrorCode.SCHEMA_INVALID)

        val types = root.requiredObject("types")
        val categories = root.requiredObject("categories")
        ensure(types.isNotEmpty() && categories.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
        types.forEach { (_, typeElement) ->
            val type = typeElement.asObject()
            ensure(type["ketherFillable"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(type.requiredString("rawType").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            for (field in listOf("parents", "children", "assignableFrom")) {
                type.requiredArray(field).forEach { referenced ->
                    ensure(types.containsKey(referenced.jsonPrimitive.content), KetherDocsErrorCode.SCHEMA_INVALID)
                }
            }
        }

        val ids = linkedSetOf<String>()
        validateItems(root.requiredArray("actions"), ids, requireNonEmpty = true) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("namespace").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(categories.containsKey(item.requiredString("category")), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("flow") in setOf("normal", "branch", "loop", "container"), KetherDocsErrorCode.SCHEMA_INVALID)
            item.requiredArray("aliases").forEach { alias ->
                val aliasObject = alias.asObject()
                ensure(aliasObject.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(aliasObject.requiredString("kind") in setOf("parser", "deprecated", "compatibility"), KetherDocsErrorCode.SCHEMA_INVALID)
            }
            val grammar = item.requiredObject("grammar")
            ensure(grammar.requiredString("syntax").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(grammar.requiredArray("variants").isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
            grammar.requiredArray("inputs").forEach { inputElement ->
                val input = inputElement.asObject()
                ensure(types.containsKey(input.requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input["required"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input.containsKey("default"), KetherDocsErrorCode.SCHEMA_INVALID)
                val acceptedTypes = input.requiredArray("acceptedTypes")
                ensure(acceptedTypes.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
                acceptedTypes.forEach { accepted -> ensure(types.containsKey(accepted.jsonPrimitive.content), KetherDocsErrorCode.SCHEMA_INVALID) }
            }
            val execution = item.requiredObject("execution")
            ensure(execution.requiredString("thread") in setOf("main", "async", "any", "unknown"), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(execution["suspends"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
            val output = item.requiredObject("output")
            when (output.requiredString("status")) {
                "none", "unknown" -> Unit
                "declared" -> ensure(types.containsKey(output.requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
                else -> throw KetherDocsFailure(KetherDocsErrorCode.SCHEMA_INVALID)
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
            for (field in listOf("variables", "specialKeys")) {
                item.requiredArray(field).forEach { variable ->
                    ensure(types.containsKey(variable.asObject().requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
                }
            }
        }
        validateItems(root.requiredArray("properties"), ids) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            item.requiredArray("keys").forEach { key ->
                ensure(types.containsKey(key.asObject().requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
            }
        }
        ParsedSchema(pluginVersion, commit, registryVersion)
    }

    private fun validateSchemaDocument(
        bytes: ByteArray,
        expectedPluginVersion: String? = null,
        expectedCommit: String? = null,
        expectedSchemaVersion: Int? = null,
        expectedSchemaVersions: Set<Int> = SUPPORTED_SCHEMA_VERSIONS
    ): ParsedSchema = guarded(KetherDocsErrorCode.SCHEMA_INVALID) {
        val root = parseObject(bytes, KetherDocsErrorCode.SCHEMA_INVALID)
        val schemaVersion = root.requiredInt("schemaVersion")
        ensure(schemaVersion in SUPPORTED_SCHEMA_VERSIONS, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(expectedSchemaVersion == null || schemaVersion == expectedSchemaVersion, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(schemaVersion in expectedSchemaVersions, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(
            root.requiredString("\$schema") == config.baseUri.resolve("contracts/actions-schema-v$schemaVersion.schema.json").toString(),
            KetherDocsErrorCode.SCHEMA_INVALID
        )
        ensure(root.requiredInt("version") == 2, KetherDocsErrorCode.SCHEMA_UNSUPPORTED)
        ensure(root.requiredString("pluginId") == "Orryx", KetherDocsErrorCode.SCHEMA_INVALID)
        val pluginVersion = root.requiredString("pluginVersion")
        val commit = root.requiredString("commit")
        ensure(versionPattern.matches(pluginVersion), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(commitPattern.matches(commit), KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedPluginVersion == null || pluginVersion == expectedPluginVersion, KetherDocsErrorCode.SCHEMA_INVALID)
        ensure(expectedCommit == null || commit == expectedCommit, KetherDocsErrorCode.SCHEMA_INVALID)

        val types = root.requiredObject("types")
        val categories = root.requiredObject("categories")
        ensure(types.isNotEmpty() && categories.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
        if (schemaVersion >= 4) {
            types.forEach { (_, typeElement) ->
                val type = typeElement.asObject()
                ensure(type["ketherFillable"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(type.requiredString("inputStrategy") in setOf("expression", "literal", "raw"), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(type.requiredString("serialization") in setOf("token", "quoted", "raw", "json", "duration"), KetherDocsErrorCode.SCHEMA_INVALID)
                type.requiredArray("extends").forEach { parent ->
                    ensure(types.containsKey(parent.jsonPrimitive.content), KetherDocsErrorCode.SCHEMA_INVALID)
                }
            }
        }
        val ids = linkedSetOf<String>()

        validateItems(root.requiredArray("actions"), ids, requireNonEmpty = true) { item ->
            ensure(item.requiredString("name").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("namespace").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(categories.containsKey(item.requiredString("category")), KetherDocsErrorCode.SCHEMA_INVALID)
            ensure(item.requiredString("syntax").isNotBlank(), KetherDocsErrorCode.SCHEMA_INVALID)
            if (schemaVersion >= 4) {
                ensure(idPattern.matches(item.requiredString("variantId")), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(item.requiredString("shape") in setOf("command", "reporter", "predicate", "container", "raw"), KetherDocsErrorCode.SCHEMA_INVALID)
            }
            item.requiredArray("inputs").forEach { inputElement ->
                val input = inputElement.asObject()
                ensure(types.containsKey(input.requiredString("type")), KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input["required"]?.jsonPrimitive?.booleanOrNull != null, KetherDocsErrorCode.SCHEMA_INVALID)
                ensure(input.containsKey("default"), KetherDocsErrorCode.SCHEMA_INVALID)
                if (schemaVersion >= 4) {
                    val accepts = input.requiredArray("accepts")
                    ensure(accepts.isNotEmpty(), KetherDocsErrorCode.SCHEMA_INVALID)
                    accepts.forEach { accepted -> ensure(types.containsKey(accepted.jsonPrimitive.content), KetherDocsErrorCode.SCHEMA_INVALID) }
                }
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
            schemaVersion = schemaVersion
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

    private fun JsonObject.optionalInt(name: String): Int? = this[name]?.jsonPrimitive?.intOrNull

    private fun JsonObject.requiredInt(name: String): Int = this[name]?.jsonPrimitive?.intOrNull
        ?: throw IllegalArgumentException("missing integer: $name")

    private fun JsonObject.requiredObject(name: String): JsonObject = this[name]
        ?.let { runCatching { it.jsonObject }.getOrNull() }
        ?: throw IllegalArgumentException("missing object: $name")

    private fun JsonObject.optionalObject(name: String): JsonObject? = this[name]
        ?.takeUnless { it is JsonNull }
        ?.let { runCatching { it.jsonObject }.getOrNull() }

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

    private fun validateAsset(asset: KetherAsset, expectedPath: String) {
        ensure(asset.path == expectedPath, KetherDocsErrorCode.MANIFEST_INVALID)
        ensure(asset.mediaType.substringBefore(';').trim() == "application/json", KetherDocsErrorCode.MANIFEST_INVALID)
        ensure(asset.bytes in 1..config.maxSchemaBytes, KetherDocsErrorCode.SCHEMA_TOO_LARGE)
        ensure(shaPattern.matches(asset.sha256), KetherDocsErrorCode.MANIFEST_INVALID)
    }

    private fun validateAssetBytes(bytes: ByteArray, asset: KetherAsset): String {
        ensure(bytes.size.toLong() == asset.bytes, KetherDocsErrorCode.SCHEMA_SIZE_MISMATCH)
        val digest = sha256(bytes)
        ensure(digest == asset.sha256, KetherDocsErrorCode.SCHEMA_CHECKSUM_INVALID)
        return digest
    }

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
        val schemaVersion: Int
    )

    private companion object {
        val SUPPORTED_SCHEMA_VERSIONS = setOf(3, 4)
    }
}
