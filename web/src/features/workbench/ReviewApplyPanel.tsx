import "@/lib/monaco-loader"
import { DiffEditor } from "@monaco-editor/react"
import { Check, CircleAlert, RotateCcw, Rocket, X } from "lucide-react"
import type { CloudDraft, CloudDraftFileChange, CloudDraftVersion } from "@/lib/cloud-drafts"
import type { ReleaseTransaction } from "@/lib/workbench-api"
import type { ArtifactSummary, FileReviewStatus, ReleaseGateResult } from "./workbench-utils"
import { releaseFailureGuidance, releaseStatusDescriptor } from "./workbench-utils"

interface ReviewApplyPanelProps {
  draft: CloudDraft | null
  versions: CloudDraftVersion[]
  version: CloudDraftVersion | null
  selectedFile: CloudDraftFileChange | null
  originalContent: string
  artifact: ArtifactSummary
  fileReviews: Record<string, FileReviewStatus>
  expectedBaseManifest: string
  targetManifest: string
  releaseGate: ReleaseGateResult
  transaction: ReleaseTransaction | null
  publishing: boolean
  onSelectVersion: (versionId: string) => void
  onSelectFile: (path: string) => void
  onReview: (path: string, status: FileReviewStatus) => void
  onPublish: () => Promise<void>
  onRollback: () => Promise<void>
}

export function ReviewApplyPanel(props: ReviewApplyPanelProps) {
  const transactionStatus = props.transaction ? releaseStatusDescriptor(props.transaction.status) : null
  const canRollback = props.transaction && !["ROLLED_BACK", "QUEUED"].includes(props.transaction.status)

  return (
    <section className="workbench-pane workbench-review" aria-label="审核与发布">
      <header className="workbench-pane-header"><div><p className="workbench-kicker">REVIEW &amp; APPLY</p><h2>草稿版本审核</h2></div>{transactionStatus && <span className={`workbench-status workbench-status--${transactionStatus.tone}`}>{transactionStatus.label}</span>}</header>

      {!props.draft ? <div className="workbench-empty workbench-empty--large"><strong>选择草稿开始审核</strong><span>中栏 AI 的成功结果会追加草稿版本，不会写入或 reload 生产文件。</span></div> : (
        <>
          <section className="workbench-version-strip" aria-labelledby="version-timeline-title">
            <div className="workbench-section-title"><h3 id="version-timeline-title">版本时间线</h3><span>{props.versions.length}</span></div>
            {props.versions.length === 0 ? <p className="workbench-empty" role="status">正在读取草稿版本，或该草稿尚无版本。</p> : <div className="workbench-version-list">{props.versions.map((version) => <button type="button" key={version.id} className={props.version?.id === version.id ? "is-active" : undefined} onClick={() => props.onSelectVersion(version.id)}><strong>v{version.versionNumber}</strong><span>{version.source}</span><time>{formatTime(version.createdAt)}</time></button>)}</div>}
          </section>

          {props.version && (
            <>
              <div className="workbench-review-layout">
                <nav className="workbench-file-list" aria-label="版本文件">
                  {(props.version.files ?? []).map((file) => { const review = props.fileReviews[file.path] ?? "PENDING"; return <button type="button" key={file.path} className={props.selectedFile?.path === file.path ? "is-active" : undefined} onClick={() => props.onSelectFile(file.path)}><span><strong>{file.path}</strong><small>{file.changeType} · {formatBytes(file.content?.length ?? 0)}</small></span><ReviewMark status={review} /></button> })}
                </nav>
                <div className="workbench-diff-shell">
                  {props.selectedFile ? <DiffEditor height="100%" language={languageForPath(props.selectedFile.path)} original={props.originalContent} modified={props.selectedFile.content ?? ""} theme="vs-dark" options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, originalEditable: false }} /> : <div className="workbench-empty workbench-empty--large"><strong>选择文件查看差异</strong><span>original 来自 base snapshot，candidate 来自当前草稿版本。</span></div>}
                </div>
              </div>

              {props.selectedFile && <div className="workbench-file-review-actions"><span>文件审核状态：{reviewLabel(props.fileReviews[props.selectedFile.path] ?? "PENDING")}</span><div><button className="industrial-button industrial-button--danger-quiet" type="button" onClick={() => props.onReview(props.selectedFile!.path, "CHANGES_REQUESTED")}><X aria-hidden="true" />要求修改</button><button className="industrial-button industrial-button--success" type="button" onClick={() => props.onReview(props.selectedFile!.path, "APPROVED")}><Check aria-hidden="true" />审核通过</button></div></div>}

              <ArtifactSummaryView artifact={props.artifact} />

              <section className="workbench-release" aria-labelledby="release-title">
                <div className="workbench-section-title"><h3 id="release-title">发布门禁</h3><span>{props.releaseGate.allowed ? "READY" : "BLOCKED"}</span></div>
                <dl className="workbench-manifest-grid"><div><dt>Expected base manifest</dt><dd><code>{props.expectedBaseManifest || "缺失"}</code></dd></div><div><dt>Target manifest</dt><dd><code>{props.targetManifest || "缺失"}</code></dd></div></dl>
                {!props.releaseGate.allowed && <ul className="workbench-gate-reasons">{props.releaseGate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                <div className="workbench-release-actions"><button className="industrial-button industrial-button--primary" type="button" onClick={() => void props.onPublish()} disabled={!props.releaseGate.allowed || props.publishing}><Rocket aria-hidden="true" />{props.publishing ? "正在创建发布事务…" : "发布已审核版本"}</button>{canRollback && <button className="industrial-button industrial-button--danger-quiet" type="button" onClick={() => void props.onRollback()}><RotateCcw aria-hidden="true" />明确回滚此事务</button>}</div>

                {props.transaction && <div className={`workbench-transaction workbench-transaction--${transactionStatus?.tone ?? "neutral"}`} aria-live="polite"><header><strong>{transactionStatus?.label}</strong><code>{props.transaction.id}</code></header><dl><div><dt>状态</dt><dd>{props.transaction.status}</dd></div><div><dt>State version</dt><dd>{props.transaction.stateVersion}</dd></div><div><dt>更新时间</dt><dd>{formatTime(props.transaction.updatedAt)}</dd></div></dl>{props.transaction.status === "FAILED" || props.transaction.status === "RECOVERY_REQUIRED" ? <p><CircleAlert aria-hidden="true" />{releaseFailureGuidance(props.transaction.errorCode)}</p> : props.transaction.status === "ROLLED_BACK" ? <p><RotateCcw aria-hidden="true" />生产已回滚。草稿仍保留，可修复后重新审核发布。</p> : null}</div>}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

function ArtifactSummaryView({ artifact }: { artifact: ArtifactSummary }) {
  return <section className="workbench-artifact" aria-labelledby="artifact-title"><div className="workbench-section-title"><h3 id="artifact-title">Diagnostics / Checks / References</h3><span>{artifact.diagnostics.length + artifact.checks.length}</span></div><div className="workbench-artifact-grid"><div><h4>Diagnostics</h4>{artifact.diagnostics.length ? <ul>{artifact.diagnostics.map((item, index) => <li key={`${item.code}:${item.path}:${index}`} className={`is-${item.severity}`}><strong>{item.code ?? item.severity.toUpperCase()}</strong><span>{item.path ? `${item.path}${item.line ? `:${item.line}` : ""} · ` : ""}{item.message}</span></li>)}</ul> : <p>无结构化诊断。</p>}</div><div><h4>Checks</h4>{artifact.checks.length ? <ul>{artifact.checks.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.status}{item.detail ? ` · ${item.detail}` : ""}</span></li>)}</ul> : <p>无检查结果。</p>}</div><div><h4>References</h4>{artifact.references.length ? <ul>{artifact.references.map((item) => <li key={item}>{item}</li>)}</ul> : <p>无引用摘要。</p>}</div><div><h4>Requirements</h4>{artifact.requirements.length ? <ul>{artifact.requirements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>无额外要求。</p>}</div></div></section>
}

function ReviewMark({ status }: { status: FileReviewStatus }) {
  if (status === "APPROVED") return <span className="workbench-review-mark is-approved"><Check aria-hidden="true" />通过</span>
  if (status === "CHANGES_REQUESTED") return <span className="workbench-review-mark is-rejected"><X aria-hidden="true" />修改</span>
  return <span className="workbench-review-mark">待审核</span>
}

function reviewLabel(status: FileReviewStatus): string {
  return status === "APPROVED" ? "审核通过" : status === "CHANGES_REQUESTED" ? "要求修改" : "待审核"
}

function languageForPath(path: string): string {
  if (/\.ya?ml$/i.test(path)) return "yaml"
  if (/\.json$/i.test(path)) return "json"
  if (/\.toml$/i.test(path)) return "ini"
  return "plaintext"
}

function formatBytes(length: number): string {
  return length < 1024 ? `${length} B` : `${(length / 1024).toFixed(1)} KiB`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date)
}
