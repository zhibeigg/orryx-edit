import { useState } from "react"
import { AlertTriangle, GitCompare, RefreshCw, Upload } from "lucide-react"
import { DiffView } from "@/components/editor/DiffView"
import { deleteDraft } from "@/lib/draft-storage"
import { wsClient } from "@/lib/ws-client"
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
      const latest = await wsClient.fileRead(conflict.path)
      if (replace) {
        const current = useEditorStore.getState().openFiles.find((file) => file.path === conflict.path)
        if (current) {
          useEditorStore.getState().openFile({
            path: current.path,
            name: current.name,
            configType: current.configType,
            content: latest.content,
            revision: latest.revision,
          })
        }
        await deleteDraft(conflict.path)
        useEditorStore.getState().setSaveConflict(null)
        setLatestContent(null)
      } else {
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
      const result = await wsClient.fileWrite(
        conflict.path,
        conflict.attemptedContent,
        conflict.currentRevision,
        true,
      )
      useEditorStore.getState().markSaved(conflict.path, conflict.attemptedContent, result.revision)
      await deleteDraft(conflict.path)
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
