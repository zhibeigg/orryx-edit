package com.orryx.editor.versioning

import com.orryx.editor.snapshot.SnapshotLimits
import com.orryx.editor.snapshot.SnapshotManifest
import java.util.Locale

object DraftFileValidation {
    fun validate(files: List<DraftFile>, limits: SnapshotLimits = SnapshotLimits()) {
        require(files.isNotEmpty()) { "draft version 至少需要一个文件变更" }
        require(files.size <= limits.maxFiles) { "draft version 文件数量超过上限 ${limits.maxFiles}" }
        val paths = HashSet<String>(files.size)
        val foldedPaths = HashMap<String, String>(files.size)
        var totalSize = 0L

        files.forEach { file ->
            SnapshotManifest.validatePath(file.path, limits.maxPathBytes)
            require(paths.add(file.path)) { "draft version 包含重复路径: ${file.path}" }
            val folded = file.path.lowercase(Locale.ROOT)
            val existing = foldedPaths.putIfAbsent(folded, file.path)
            require(existing == null) { "draft version 包含大小写冲突路径: $existing 与 ${file.path}" }
            file.baseRevision?.let { require(SnapshotManifest.isSha256(it)) { "baseRevision 无效: ${file.path}" } }

            when (file.changeType) {
                DraftFileChangeType.UPSERT -> {
                    val content = requireNotNull(file.content) { "UPSERT 必须提供 content: ${file.path}" }
                    val contentRevision = requireNotNull(file.contentRevision) {
                        "UPSERT 必须提供 contentRevision: ${file.path}"
                    }
                    require(SnapshotManifest.isSha256(contentRevision)) { "contentRevision 无效: ${file.path}" }
                    val bytes = content.toByteArray(Charsets.UTF_8)
                    require(file.size == bytes.size.toLong()) { "content 大小与 size 不一致: ${file.path}" }
                    require(file.size <= limits.maxFileBytes) { "文件大小超过上限: ${file.path}" }
                    require(SnapshotManifest.contentRevision(content) == contentRevision) {
                        "content 哈希与 contentRevision 不一致: ${file.path}"
                    }
                    require(totalSize <= limits.maxTotalBytes - file.size) {
                        "draft version 内容总大小超过上限 ${limits.maxTotalBytes}"
                    }
                    totalSize += file.size
                }

                DraftFileChangeType.DELETE -> {
                    require(file.contentRevision == null) { "DELETE 禁止 contentRevision: ${file.path}" }
                    require(file.content == null) { "DELETE 禁止 content: ${file.path}" }
                    require(file.size == 0L) { "DELETE size 必须为 0: ${file.path}" }
                }
            }
        }
    }
}
