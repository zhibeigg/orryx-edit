import { useEditorStore, type OpenFile } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { wsClient } from "@/lib/ws-client"
import { deleteDraft } from "@/lib/draft-storage"
import { useState } from "react"
import { Upload, RotateCcw, Check, AlertCircle, Eye, Undo2 } from "lucide-react"
import { DiffView } from "@/components/editor/DiffView"

export function PublishPanel() {
  const { openFiles, markSaved, updateDraft } = useEditorStore()
  const connected = useConnectionStore((s) => s.connected)
  const dirtyFiles = openFiles.filter((f) => f.dirty)
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<{ path: string; success: boolean; message?: string }[]>([])
  const [diffFile, setDiffFile] = useState<OpenFile | null>(null)

  const handlePublish = async (paths: string[], reload = false) => {
    setPublishing(true)
    setResults([])
    const newResults: typeof results = []

    for (const path of paths) {
      const file = openFiles.find((f) => f.path === path)
      if (!file?.draft) continue

      try {
        const res = await wsClient.fileWrite(path, file.draft)
        newResults.push({ path, success: res.success })
        if (res.success) {
          markSaved(path, file.draft)
          await deleteDraft(path)
        }
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
    if (file) {
      updateDraft(path, file.content)
      deleteDraft(path)
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

      {!connected && (
        <p className="text-xs text-yellow-500">当前处于离线状态，草稿已自动保存到本地。重新连接后可发布。</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => handlePublish(dirtyFiles.map((f) => f.path), false)}
          disabled={publishing || !connected}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {publishing ? "发布中..." : "发布"}
        </button>
        <button
          onClick={() => handlePublish(dirtyFiles.map((f) => f.path), true)}
          disabled={publishing || !connected}
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
