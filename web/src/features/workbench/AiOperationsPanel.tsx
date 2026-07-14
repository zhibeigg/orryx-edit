import { Ban, Bot, CircleAlert, Play, RefreshCw } from "lucide-react"
import type { AiJob, AiOperation } from "@/lib/ai-jobs"
import type { AiJobEvent, AiProviderOption } from "@/lib/workbench-api"
import { aiStatusDescriptor } from "./workbench-utils"

interface AiOperationsPanelProps {
  entitled: boolean
  draftSelected: boolean
  providers: AiProviderOption[]
  operation: AiOperation
  prompt: string
  providerId: string
  model: string
  job: AiJob | null
  events: AiJobEvent[]
  submitting: boolean
  onOperation: (operation: AiOperation) => void
  onPrompt: (prompt: string) => void
  onProvider: (providerId: string, model: string) => void
  onModel: (model: string) => void
  onSubmit: () => Promise<void>
  onCancel: () => Promise<void>
}

const operations: Array<{ value: AiOperation; label: string; detail: string }> = [
  { value: "GENERATE", label: "GENERATE", detail: "生成候选配置并追加草稿版本" },
  { value: "VALIDATE", label: "VALIDATE", detail: "验证当前草稿版本并产出诊断" },
  { value: "PLAN", label: "PLAN", detail: "生成实施计划、依赖与引用摘要" },
]

export function AiOperationsPanel(props: AiOperationsPanelProps) {
  const provider = props.providers.find((item) => (item.providerId ?? item.id) === props.providerId)
  const enabledProviders = props.providers.filter((item) => item.enabled)
  const status = props.job ? aiStatusDescriptor(props.job.status) : null
  const jobActive = props.job ? !status?.terminal : false

  return (
    <section className="workbench-pane workbench-ai" aria-label="AI 操作">
      <header className="workbench-pane-header"><div><p className="workbench-kicker">AI OPERATIONS</p><h2>生成与验证</h2></div>{status && <span className={`workbench-status workbench-status--${status.tone}`}><RefreshCw className={jobActive ? "is-spinning" : undefined} aria-hidden="true" />{status.label}</span>}</header>

      {!props.entitled ? <div className="workbench-boundary workbench-boundary--warning"><CircleAlert aria-hidden="true" /><div><strong>当前账户没有 AI 权益</strong><p>可继续查看草稿、历史与发布；前往 Portal 激活永久 AI Editor 权益后再创建任务。</p><a className="industrial-button industrial-button--quiet" href="/portal">返回 Portal 查看权益</a></div></div> : enabledProviders.length === 0 ? <div className="workbench-boundary workbench-boundary--warning"><CircleAlert aria-hidden="true" /><div><strong>没有可用 Provider</strong><p>Provider 可能被禁用或尚未配置。管理员需要在 Admin 中启用 Provider。</p></div></div> : null}

      <div className="workbench-operation-grid" role="radiogroup" aria-label="AI 操作类型">
        {operations.map((item) => <button key={item.value} type="button" role="radio" aria-checked={props.operation === item.value} className={props.operation === item.value ? "is-active" : undefined} onClick={() => props.onOperation(item.value)}><strong>{item.label}</strong><span>{item.detail}</span></button>)}
      </div>

      <div className="workbench-provider-row">
        <div className="workbench-field"><label htmlFor="workbench-provider">Provider</label><select id="workbench-provider" value={props.providerId} onChange={(event) => { const next = props.providers.find((item) => (item.providerId ?? item.id) === event.target.value); props.onProvider(event.target.value, next?.defaultModel ?? next?.models[0] ?? "") }} disabled={!props.entitled || jobActive}><option value="">选择 Provider</option>{props.providers.map((item) => <option key={item.id} value={item.providerId ?? item.id} disabled={!item.enabled}>{item.displayName ?? item.providerId ?? item.id}{item.enabled ? "" : "（已禁用）"}</option>)}</select>{provider?.disabledReason && <small>{provider.disabledReason}</small>}</div>
        <div className="workbench-field"><label htmlFor="workbench-model">Model</label><select id="workbench-model" value={props.model} onChange={(event) => props.onModel(event.target.value)} disabled={!provider?.enabled || jobActive}><option value="">选择模型</option>{provider?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
      </div>

      <div className="workbench-field workbench-prompt-field"><label htmlFor="workbench-prompt">Prompt</label><textarea id="workbench-prompt" value={props.prompt} onChange={(event) => props.onPrompt(event.target.value)} placeholder="明确说明目标、限制、目标文件与验收条件。最近输入只缓存于当前账户/工作区/服务器隔离键。" maxLength={65536} disabled={jobActive} /><small>{new TextEncoder().encode(props.prompt).length.toLocaleString("zh-CN")} / 65,536 bytes</small></div>

      <div className="workbench-ai-actions">
        <button className="industrial-button industrial-button--primary" type="button" onClick={() => void props.onSubmit()} disabled={props.submitting || jobActive || !props.entitled || !props.draftSelected || !provider?.enabled || !props.model || !props.prompt.trim()}><Play aria-hidden="true" />{props.submitting ? "正在创建任务…" : "创建 AI Job"}</button>
        {jobActive && <button className="industrial-button industrial-button--danger-quiet" type="button" onClick={() => void props.onCancel()}><Ban aria-hidden="true" />取消任务</button>}
      </div>
      {!props.draftSelected && <p className="workbench-inline-hint"><Bot aria-hidden="true" />AI Job 必须关联服务端草稿，请先在左栏选择或创建草稿。</p>}

      <section className="workbench-job" aria-labelledby="workbench-job-title" aria-live="polite">
        <div className="workbench-section-title"><h3 id="workbench-job-title">Job 事件时间线</h3><span>{props.events.length}</span></div>
        {!props.job ? <div className="workbench-empty"><strong>尚未创建 Job</strong><span>任务会异步执行；结果只会作为新的草稿版本展示。</span></div> : (
          <>
            <dl className="workbench-job-summary"><div><dt>Job ID</dt><dd><code>{props.job.id}</code></dd></div><div><dt>操作</dt><dd>{props.job.operation}</dd></div><div><dt>Provider / Model</dt><dd>{props.job.providerId} / {props.job.model}</dd></div>{props.job.errorCode && <div><dt>错误</dt><dd className="state-danger">{props.job.errorCode} · {props.job.errorMessage ?? "服务端未提供详情"}</dd></div>}</dl>
            <ol className="workbench-event-list">{props.events.map((event, index) => <li key={event.id ?? `${event.type}:${event.createdAt}:${index}`}><span aria-hidden="true" /><div><strong>{event.type}</strong><p>{event.message ?? describePayload(event.payload)}</p><time>{formatTime(event.createdAt)}</time></div></li>)}</ol>
          </>
        )}
      </section>
    </section>
  )
}

function describePayload(payload: unknown): string {
  if (typeof payload === "string") return payload
  if (payload && typeof payload === "object") return JSON.stringify(payload)
  return "状态已更新"
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { timeStyle: "medium" }).format(date)
}
