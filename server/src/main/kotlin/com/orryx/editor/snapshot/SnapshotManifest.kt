package com.orryx.editor.snapshot

import java.security.MessageDigest
import java.util.Locale

object SnapshotManifest {
    const val CANONICAL_PREFIX: String = "orryx-editor-manifest-v1\n"
    private val sha256Pattern = Regex("^[0-9a-f]{64}$")
    private val windowsDrivePattern = Regex("^[A-Za-z]:.*")
    private val windowsReservedNames = setOf(
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    )

    fun validateFiles(files: List<SnapshotFile>, limits: SnapshotLimits = SnapshotLimits()) {
        require(files.size <= limits.maxFiles) { "snapshot 文件数量超过上限 ${limits.maxFiles}" }
        val exactPaths = HashSet<String>(files.size)
        val foldedPaths = HashMap<String, String>(files.size)
        var totalSize = 0L

        files.forEach { file ->
            validatePath(file.path, limits.maxPathBytes)
            require(exactPaths.add(file.path)) { "snapshot 包含重复路径: ${file.path}" }
            val folded = file.path.lowercase(Locale.ROOT)
            val existing = foldedPaths.putIfAbsent(folded, file.path)
            require(existing == null) { "snapshot 包含大小写冲突路径: $existing 与 ${file.path}" }
            require(isSha256(file.revision)) { "文件 revision 必须是 64 位小写 SHA-256: ${file.path}" }
            require(file.size >= 0) { "文件大小不能为负数: ${file.path}" }
            require(file.size <= limits.maxFileBytes) { "文件大小超过上限: ${file.path}" }
            file.content?.let { content ->
                val bytes = content.toByteArray(Charsets.UTF_8)
                require(bytes.size.toLong() == file.size) { "content 大小与 size 不一致: ${file.path}" }
                require(sha256(bytes) == file.revision) { "content 哈希与 revision 不一致: ${file.path}" }
            }
            require(totalSize <= limits.maxTotalBytes - file.size) { "snapshot 总大小超过上限 ${limits.maxTotalBytes}" }
            totalSize += file.size
        }
    }

    fun canonicalRevision(files: List<SnapshotFile>, limits: SnapshotLimits = SnapshotLimits()): String {
        validateFiles(files, limits)
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(CANONICAL_PREFIX.toByteArray(Charsets.UTF_8))
        files.sortedBy(SnapshotFile::path).forEach { file ->
            digest.updateField(file.path)
            digest.updateField(file.size.toString())
            digest.updateField(file.revision)
            digest.update('\n'.code.toByte())
        }
        return digest.digest().toHex()
    }

    fun contentRevision(content: String): String = sha256(content.toByteArray(Charsets.UTF_8))

    fun isSha256(value: String): Boolean = sha256Pattern.matches(value)

    fun validatePath(path: String, maxPathBytes: Int = SnapshotLimits().maxPathBytes) {
        require(path.isNotEmpty()) { "path 不能为空" }
        require(path.length <= 1024) { "path 字符长度超过插件上限 1024" }
        require(path.toByteArray(Charsets.UTF_8).size <= maxPathBytes) { "path UTF-8 长度超过上限" }
        require(!path.startsWith('/') && !path.endsWith('/') && !windowsDrivePattern.matches(path)) {
            "path 必须是相对文件路径: $path"
        }
        require('\\' !in path) { "path 必须使用正斜杠: $path" }
        require('\u0000' !in path && path.none(Char::isISOControl)) { "path 不能包含控制字符: $path" }
        val segments = path.split('/')
        require(segments.none { it.isEmpty() || it == "." || it == ".." }) { "path 不能包含空、. 或 .. 段: $path" }
        require(segments.all { it.length <= 255 }) { "path 组件长度不能超过 255: $path" }
        require(segments.none { it.startsWith('.') || ':' in it || it.endsWith(' ') || it.endsWith('.') }) {
            "path 包含不安全组件: $path"
        }
        require(segments.none { it.substringBefore('.').uppercase(Locale.ROOT) in windowsReservedNames }) {
            "path 包含 Windows 保留名称: $path"
        }
    }

    private fun MessageDigest.updateField(value: String) {
        update(value.toByteArray(Charsets.UTF_8))
        update(0)
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    private fun ByteArray.toHex(): String = joinToString(separator = "") { byte -> "%02x".format(byte) }
}
