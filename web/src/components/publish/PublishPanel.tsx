import { useEditorStore, type OpenFile } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { deleteDraftSnapshotIfUnchanged } from "@/lib/draft-consistency"
import { saveEditorFile } from "@/lib/file-save"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import { wsClient } from "@/lib/ws-client"
import { useState } from "react"
import { Upload, RotateCcw, Check, AlertCircle, Eye, Undo2 } from "lucide-react"
import { DiffView } from "@/components/editor/DiffView"

export function PublishPanel() {
  const { openFiles, updateDraft } = useEditorStore()
  const connected = useConnectionStore((s) => s.connected)
  const serverOnline = useConnectionStore((s) => s.serverOnline)
  const serverAvailable = connected && serverOnline
  const dirtyFiles = openFiles.filter((f) => f.dirty)
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<{ path: string; success: boolean; message?: string }[]>([])
  const [diffFile, setDiffFile] = useState<OpenFile | null>(null)

  const handlePublish = async (paths: string[], reload = false) => {
    if (!flushEditorInputs()) return
    setPublishing(true)
    setResults([])
    const newResults: typeof results = []
    const snapshots = useEditorStore.getState().openFiles

    for (const path of paths) {
      const file = snapshots.find((candidate) => candidate.path === path)
      if (file?.draft == null) continue

      try {
        const success = await saveEditorFile(file, file.draft)
        newResults.push({ path, success, message: success ? undefined : "检测到服务器版本冲突" })
      } catch (err) {
        newResults.push({ path, success: false, message: err instanceof Error ? err.message : "未知错误" })
      }
    }

    if (reload && newResults.some((r) => r.success)) {
      try {
        await wsClient.reload("all")
      } catch {
        // 忽略 reload 错误
      }
    }

    setResults(newResults)
    setPublishing(false)
  }

  const handleRevert = (path: string) => {
    if (!confirm("确定撤销此文件的所有修改？")) return
    const file = openFiles.find((f) => f.path === path)
    if (file?.draft != null) {
      const discardedDraft = file.draft
      updateDraft(path, file.content)
      void deleteDraftSnapshotIfUnchanged(file.workspaceId, path, discardedDraft)
    }
  }

  // Diff 预览模式
  if (diffFile) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-sm truncate">{diffFile.path}</span>
          <button onClick={() => setDiffFile(null)} className="text-xs text-muted-foreground hover:text-foreground">
            返回
          </button>
        </div>
        <div className="flex-1">
          <DiffView original={diffFile.content} modified={diffFile.draft ?? diffFile.content} />
        </div>
      </div>
    )
  }

  if (dirtyFiles.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        没有待发布的更改
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold">待发布的更改 ({dirtyFiles.length})</h3>

      <div className="space-y-2">
        {dirtyFiles.map((file) => (
          <div key={file.path} className="flex items-center justify-between text-sm px-3 py-2 bg-secondary rounded group">
            <span className="truncate flex-1">{file.path}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setDiffFile(file)}
                className="p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                title="查看变更"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleRevert(file.path)}
                className="p-1 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100"
                title="撤销修改"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
            </div>
          </div>
        ))}
      </div>

      {!serverAvailable && (
        <p className="text-xs text-yellow-500">当前服务器离线，草稿与认证均已保留。插件重新连接并完成文件同步后可发布。</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => handlePublish(dirtyFiles.map((f) => f.path), false)}
          disabled={publishing || !serverAvailable}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {publishing ? "发布中..." : "发布"}
        </button>
        <button
          onClick={() => handlePublish(dirtyFiles.map((f) => f.path), true)}
          disabled={publishing || !serverAvailable}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          发布并重载
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r) => (
            <div key={r.path} className={`flex items-center gap-2 text-sm ${r.success ? "text-green-400" : "text-red-400"}`}>
              {r.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{r.path}</span>
              {r.message && <span className="text-muted-foreground">- {r.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
