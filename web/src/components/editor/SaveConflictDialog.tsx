import { useState } from "react"
import { AlertTriangle, GitCompare, RefreshCw, Upload } from "lucide-react"
import { DiffView } from "@/components/editor/DiffView"
import { displayedContentOf, draftVersionOf } from "@/lib/editor-file-state"
import { saveEditorFile } from "@/lib/file-save"
import { readServerFile, reloadEditorFileFromServer } from "@/lib/server-file"
import { useEditorStore } from "@/store/editor-store"

export function SaveConflictDialog() {
  const conflict = useEditorStore((state) => state.saveConflict)
  const [latestContent, setLatestContent] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!conflict) return null

  const loadLatest = async (replace: boolean) => {
    setWorking(true)
    setError(null)
    try {
      if (replace) {
        const current = useEditorStore.getState().openFiles.find((file) => file.path === conflict.path)
        if (!current) throw new Error("文件已关闭，无法重新加载")
        await reloadEditorFileFromServer(
          conflict.path,
          draftVersionOf(current),
          displayedContentOf(current),
        )
        setLatestContent(null)
      } else {
        const latest = await readServerFile(conflict.path)
        setLatestContent(latest.content)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取服务器最新版本")
    } finally {
      setWorking(false)
    }
  }

  const forceOverwrite = async () => {
    setWorking(true)
    setError(null)
    try {
      const current = useEditorStore.getState().openFiles.find((file) => file.path === conflict.path)
      if (!current) throw new Error("文件已关闭，无法强制覆盖")
      const success = await saveEditorFile(current, conflict.attemptedContent, {
        force: true,
        baseRevision: conflict.currentRevision,
        draftVersion: conflict.attemptedDraftVersion,
      })
      if (!success) throw new Error("强制覆盖未成功")
      setLatestContent(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "强制覆盖失败")
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="section-heading">
          <AlertTriangle aria-hidden="true" />
          <div>
            <h2 id="conflict-title">文件已被其他协作者修改</h2>
            <p><code className="long-value">{conflict.path}</code> 的服务器版本已经更新。你的内容尚未被覆盖。</p>
          </div>
        </div>

        {latestContent != null && (
          <div className="conflict-diff" aria-label="服务器版本与本地修改对比">
            <DiffView original={latestContent} modified={conflict.attemptedContent} />
          </div>
        )}

        {error && <p className="status-message status-message--error" role="alert">{error}</p>}
        <div className="dialog-actions conflict-actions">
          <button className="industrial-button industrial-button--quiet" type="button" disabled={working} onClick={() => void loadLatest(true)}>
            <RefreshCw aria-hidden="true" />重新加载
          </button>
          <button className="industrial-button industrial-button--quiet" type="button" disabled={working} onClick={() => void loadLatest(false)}>
            <GitCompare aria-hidden="true" />对比
          </button>
          <button className="industrial-button industrial-button--warning" type="button" disabled={working} onClick={() => void forceOverwrite()}>
            <Upload aria-hidden="true" />强制覆盖
          </button>
        </div>
      </section>
    </div>
  )
}
