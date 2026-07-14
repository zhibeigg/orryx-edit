package com.orryx.editor.release

import com.orryx.editor.snapshot.SnapshotManifest
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets

object ReleaseCanonicalPayload {
    private val magic = "ORRYX-RELEASE".toByteArray(StandardCharsets.US_ASCII)
    const val VERSION: Byte = 1

    data class Input(
        val keyId: String,
        val releaseId: String,
        val serverInstanceId: String,
        val stableServerId: String,
        val draftId: String,
        val draftVersionId: String,
        val expectedBaseManifestRevision: String,
        val targetManifestRevision: String,
        val createdAtEpochMillis: Long,
        val files: List<File>
    )

    data class File(
        val path: String,
        val baseRevision: String?,
        val contentRevision: String,
        val size: Long
    )

    fun encode(input: Input): ByteArray {
        require(input.files.size <= Int.MAX_VALUE) { "release 文件数量过多" }
        require(SnapshotManifest.isSha256(input.expectedBaseManifestRevision)) { "expectedBaseManifestRevision 无效" }
        require(SnapshotManifest.isSha256(input.targetManifestRevision)) { "targetManifestRevision 无效" }
        val sorted = input.files.sortedBy(File::path)
        require(sorted.map(File::path).distinct().size == sorted.size) { "release 文件路径不能重复" }

        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.write(magic)
            output.writeByte(0)
            output.writeByte(VERSION.toInt())
            output.writeUtf8Field(input.keyId)
            output.writeUtf8Field(input.releaseId)
            output.writeUtf8Field(input.serverInstanceId)
            output.writeUtf8Field(input.stableServerId)
            output.writeUtf8Field(input.draftId)
            output.writeUtf8Field(input.draftVersionId)
            output.writeUtf8Field(input.expectedBaseManifestRevision)
            output.writeUtf8Field(input.targetManifestRevision)
            output.writeLong(input.createdAtEpochMillis)
            output.writeInt(sorted.size)
            sorted.forEach { file ->
                SnapshotManifest.validatePath(file.path)
                require(file.size >= 0) { "release 文件大小不能为负数: ${file.path}" }
                output.writeUtf8Field(file.path)
                if (file.baseRevision == null) {
                    output.writeByte(0)
                } else {
                    output.writeByte(1)
                    output.writeSha256(file.baseRevision)
                }
                output.writeSha256(file.contentRevision)
                output.writeLong(file.size)
            }
        }
        return bytes.toByteArray()
    }

    private fun DataOutputStream.writeUtf8Field(value: String) {
        val encoded = value.toByteArray(StandardCharsets.UTF_8)
        writeInt(encoded.size)
        write(encoded)
    }

    private fun DataOutputStream.writeSha256(value: String) {
        require(SnapshotManifest.isSha256(value)) { "revision 必须是 64 位小写 SHA-256" }
        write(value.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    }
}
