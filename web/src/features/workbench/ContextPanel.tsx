import { useState, type FormEvent } from "react"
import { ArchiveRestore, Clock3, FilePlus2, History, Server, Waypoints } from "lucide-react"
import type { CloudDraft } from "@/lib/cloud-drafts"
import type { ServerHistoryEntry, ServerSnapshot } from "@/lib/workbench-api"

interface ContextPanelProps {
  workspaceId: string
  serverInstanceId: string
  snapshots: ServerSnapshot[]
  history: ServerHistoryEntry[]
  drafts: CloudDraft[]
  selectedDraftId: string | null
  loading: boolean
  onSelectDraft: (draftId: string) => void
  onCreateDraft: (snapshotId: string, title: string) => Promise<void>
  onRestore: (snapshotId: string) => Promise<void>
  onRefresh: () => void
}

export function ContextPanel(props: ContextPanelProps) {
  const [title, setTitle] = useState("")
  const [snapshotId, setSnapshotId] = useState(() => props.snapshots[0]?.id ?? "")
  const [creating, setCreating] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [mode, setMode] = useState<"drafts" | "history">("drafts")

  const effectiveSnapshotId = snapshotId || props.snapshots[0]?.id || ""

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!effectiveSnapshotId || !title.trim()) return
    setCreating(true)
    try {
      await props.onCreateDraft(effectiveSnapshotId, title.trim())
      setTitle("")
    } finally {
      setCreating(false)
    }
  }

  const restore = async (entry: ServerHistoryEntry) => {
    const targetId = entry.snapshotId ?? entry.releaseId ?? entry.id
    if (!targetId) return
    setRestoringId(entry.id)
    try {
      await props.onRestore(targetId)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <aside className="workbench-pane workbench-context" aria-label="工作台上下文">
      <header className="workbench-pane-header">
        <div><p className="workbench-kicker">CONTEXT</p><h2>服务器上下文</h2></div>
        <button className="workbench-icon-button" type="button" onClick={props.onRefresh} aria-label="刷新服务器上下文"><Clock3 aria-hidden="true" /></button>
      </header>

      <dl className="workbench-identity">
        <div><dt>Workspace</dt><dd title={props.workspaceId}><Waypoints aria-hidden="true" />{props.workspaceId}</dd></div>
        <div><dt>Server Instance</dt><dd title={props.serverInstanceId}><Server aria-hidden="true" />{props.serverInstanceId}</dd></div>
        <div><dt>最新 Snapshot</dt><dd>{props.snapshots[0]?.manifestRevision ?? "尚无快照"}</dd></div>
      </dl>

      <div className="workbench-segmented" role="tablist" aria-label="上下文视图">
        <button type="button" role="tab" aria-selected={mode === "drafts"} onClick={() => setMode("drafts")}>草稿</button>
        <button type="button" role="tab" aria-selected={mode === "history"} onClick={() => setMode("history")}>历史</button>
      </div>

      {mode === "drafts" ? (
        <>
          <form className="workbench-create-draft" onSubmit={(event) => void submit(event)}>
            <div className="workbench-field"><label htmlFor="workbench-snapshot">Base Snapshot</label><select id="workbench-snapshot" value={effectiveSnapshotId} onChange={(event) => setSnapshotId(event.target.value)} disabled={props.snapshots.length === 0}>{props.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{formatTime(snapshot.createdAt)} · {snapshot.manifestRevision.slice(0, 12)}</option>)}</select></div>
            <div className="workbench-field"><label htmlFor="workbench-draft-title">草稿标题</label><input id="workbench-draft-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：调整技能冷却与提示" maxLength={120} /></div>
            <button className="industrial-button industrial-button--primary" type="submit" disabled={creating || !effectiveSnapshotId || !title.trim()}><FilePlus2 aria-hidden="true" />{creating ? "正在创建草稿…" : "创建草稿"}</button>
          </form>

          <section className="workbench-list-section" aria-labelledby="draft-list-title">
            <div className="workbench-section-title"><h3 id="draft-list-title">服务端草稿</h3><span>{props.drafts.length}</span></div>
            {props.loading ? <p className="workbench-empty" role="status">正在加载草稿列表…</p> : props.drafts.length === 0 ? <div className="workbench-empty"><strong>尚无草稿</strong><span>先选择服务器快照并创建草稿；AI 结果只会追加到草稿版本。</span></div> : (
              <div className="workbench-select-list">
                {props.drafts.map((draft) => <button type="button" key={draft.id} className={props.selectedDraftId === draft.id ? "is-active" : undefined} onClick={() => props.onSelectDraft(draft.id)}><span><strong>{draft.title}</strong><small>v{draft.currentVersion} · {draft.status}</small></span><time>{formatTime(draft.updatedAt)}</time></button>)}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="workbench-list-section workbench-history" aria-labelledby="history-title">
          <div className="workbench-section-title"><h3 id="history-title"><History aria-hidden="true" />Snapshot / Release</h3><span>{props.history.length}</span></div>
          {props.loading ? <p className="workbench-empty" role="status">正在加载服务器历史…</p> : props.history.length === 0 ? <div className="workbench-empty"><strong>暂无历史记录</strong><span>网络恢复后可重新拉取；本地缓存不代表已同步。</span></div> : (
            <ol className="workbench-timeline">
              {props.history.map((entry) => <li key={`${entry.kind}:${entry.id}`}><span className={`workbench-status-dot workbench-status-dot--${entry.status.toLowerCase()}`} aria-hidden="true" /><div><header><strong>{entry.kind === "SNAPSHOT" ? "Snapshot" : "Release"}</strong><time>{formatTime(entry.createdAt)}</time></header><dl><div><dt>Manifest</dt><dd><code>{entry.manifestRevision}</code></dd></div><div><dt>来源 / 状态</dt><dd>{entry.source} · {entry.status}</dd></div></dl><button className="industrial-button industrial-button--quiet" type="button" onClick={() => void restore(entry)} disabled={Boolean(restoringId) || !(entry.snapshotId ?? entry.releaseId ?? entry.id)}><ArchiveRestore aria-hidden="true" />{restoringId === entry.id ? "正在创建草稿…" : "从此版本创建草稿"}</button></div></li>)}
            </ol>
          )}
        </section>
      )}
    </aside>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date)
}
