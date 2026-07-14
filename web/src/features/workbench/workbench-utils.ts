import type { AiJobStatus } from "@/lib/ai-jobs"
import type { CloudDraft, CloudDraftVersion } from "@/lib/cloud-drafts"
import type { ReleaseTransactionStatus } from "@/lib/workbench-api"

export type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger"

export interface StatusDescriptor {
  label: string
  tone: StatusTone
  terminal: boolean
}

const AI_STATUS: Record<AiJobStatus, StatusDescriptor> = {
  QUEUED: { label: "排队中", tone: "neutral", terminal: false },
  RUNNING: { label: "执行中", tone: "progress", terminal: false },
  SUCCEEDED: { label: "已完成", tone: "success", terminal: true },
  FAILED: { label: "失败", tone: "danger", terminal: true },
  CANCELED: { label: "已取消", tone: "warning", terminal: true },
}

const PASS_CHECK_STATUSES = new Set(["pass", "passed", "ok", "success", "succeeded"])
const PASS_ARTIFACT_STATUSES = new Set(["pass", "passed", "ok", "success", "succeeded", "completed"])

const RELEASE_STATUS: Record<ReleaseTransactionStatus, StatusDescriptor> = {
  QUEUED: { label: "已排队", tone: "neutral", terminal: false },
  PREPARE_DISPATCHED: { label: "准备指令已发送", tone: "progress", terminal: false },
  PREPARED: { label: "已准备", tone: "progress", terminal: false },
  COMMIT_DISPATCHED: { label: "提交指令已发送", tone: "progress", terminal: false },
  READINESS_PENDING: { label: "等待服务器就绪", tone: "warning", terminal: false },
  ROLLBACK_DISPATCHED: { label: "回滚指令已发送", tone: "warning", terminal: false },
  SUCCEEDED: { label: "发布成功", tone: "success", terminal: true },
  ROLLED_BACK: { label: "已回滚", tone: "warning", terminal: true },
  FAILED: { label: "发布失败", tone: "danger", terminal: true },
  RECOVERY_REQUIRED: { label: "需要人工恢复", tone: "danger", terminal: false },
}

export function aiStatusDescriptor(status: AiJobStatus): StatusDescriptor {
  return AI_STATUS[status]
}

export function releaseStatusDescriptor(status: ReleaseTransactionStatus): StatusDescriptor {
  return RELEASE_STATUS[status]
}

export interface ArtifactDiagnostic {
  severity: "error" | "warning" | "info"
  message: string
  path?: string
  line?: number
  code?: string
}

export interface ArtifactCheck {
  name: string
  status: string
  detail?: string
}

export interface ArtifactSummary {
  available: boolean
  status?: string
  diagnostics: ArtifactDiagnostic[]
  checks: ArtifactCheck[]
  references: string[]
  requirements: string[]
  draftVersionId?: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined

function referenceList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item] : []
    const entry = record(item)
    if (!entry) return []
    const label = stringValue(entry.label) ?? stringValue(entry.name) ?? stringValue(entry.path)
    if (label) return [label]
    const source = stringValue(entry.source)
    const target = stringValue(entry.target)
    const kind = stringValue(entry.kind)
    if (!source && !target && !kind) return []
    return [`${kind ? `${kind}: ` : ""}${source ?? "?"}${target ? ` → ${target}` : ""}`]
  })
}

function requirementList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item] : []
    const entry = record(item)
    if (!entry) return []
    const code = stringValue(entry.code)
    const message = stringValue(entry.message) ?? stringValue(entry.detail) ?? stringValue(entry.label)
    if (!code && !message) return []
    return [`${code ? `${code}: ` : ""}${message ?? "未满足的外部要求"}`]
  })
}

export function parseArtifactDiagnostics(input: unknown): ArtifactSummary {
  const root = record(input)
  const artifact = root ? record(root.artifact) ?? record(root.result) ?? root : {}
  const rawDiagnostics = Array.isArray(artifact.diagnostics) ? artifact.diagnostics : []
  const rawChecks = Array.isArray(artifact.checks) ? artifact.checks : []

  const diagnostics = rawDiagnostics.flatMap((item): ArtifactDiagnostic[] => {
    const value = record(item)
    const message = value && (stringValue(value.message) ?? stringValue(value.detail))
    if (!value || !message) return []
    const rawSeverity = stringValue(value.severity)?.toLowerCase()
    const severity: ArtifactDiagnostic["severity"] = rawSeverity === "error" || rawSeverity === "warning" ? rawSeverity : "info"
    return [{
      severity,
      message,
      path: stringValue(value.path) ?? stringValue(value.file),
      line: typeof value.line === "number" ? value.line : undefined,
      code: stringValue(value.code),
    }]
  })

  const checks = rawChecks.flatMap((item): ArtifactCheck[] => {
    const value = record(item)
    const name = value && (stringValue(value.code) ?? stringValue(value.name) ?? stringValue(value.label))
    if (!value || !name) return []
    return [{ name, status: stringValue(value.status) ?? "UNKNOWN", detail: stringValue(value.message) ?? stringValue(value.detail) }]
  })

  return {
    available: root !== null,
    status: stringValue(artifact.status) ?? (root ? stringValue(root.status) : undefined),
    diagnostics,
    checks,
    references: referenceList(artifact.references),
    requirements: requirementList(artifact.requirements),
    draftVersionId: stringValue(artifact.draftVersionId) ?? (root ? stringValue(root.draftVersionId) : undefined),
  }
}

export type FileReviewStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED"

export interface ReleaseGateInput {
  draft: CloudDraft | null
  version: CloudDraftVersion | null
  artifact: ArtifactSummary
  fileReviews: Record<string, FileReviewStatus>
  expectedBaseManifest: string
  targetManifest: string
  transactionActive: boolean
}

export interface ReleaseGateResult {
  allowed: boolean
  reasons: string[]
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const reasons: string[] = []
  if (!input.draft) reasons.push("请选择草稿。")
  if (!input.version) reasons.push("请选择草稿版本。")
  if (input.draft && input.version && input.version.versionNumber !== input.draft.currentVersion) reasons.push("只能发布草稿的当前版本。")
  if (!input.expectedBaseManifest.trim()) reasons.push("缺少 expected base manifest。")
  if (!input.targetManifest.trim()) reasons.push("缺少 target manifest。")
  if (input.transactionActive) reasons.push("已有发布事务正在执行。")

  const files = input.version?.files ?? []
  if (files.length === 0) reasons.push("当前版本没有可发布文件。")
  const pending = files.filter((file) => input.fileReviews[file.path] !== "APPROVED")
  if (pending.length > 0) reasons.push(`仍有 ${pending.length} 个文件未审核通过。`)

  if (input.version?.source === "AI") {
    if (!input.artifact.available) {
      reasons.push("当前 AI 版本缺少可验证的 Runner 结果。")
    } else {
      const errorCount = input.artifact.diagnostics.filter((item) => item.severity === "error").length
      if (errorCount > 0) reasons.push(`Runner 仍有 ${errorCount} 个 error diagnostics。`)
      const failedChecks = input.artifact.checks.filter((item) => !PASS_CHECK_STATUSES.has(item.status.toLowerCase()))
      if (failedChecks.length > 0) reasons.push(`Runner 仍有 ${failedChecks.length} 个未通过 checks。`)
      if (input.artifact.requirements.length > 0) reasons.push(`仍有 ${input.artifact.requirements.length} 个 requirements 未满足。`)
      const status = input.artifact.status?.toLowerCase()
      if (status && !PASS_ARTIFACT_STATUSES.has(status)) reasons.push(`Runner 结果状态为 ${input.artifact.status}。`)
    }
  }

  return { allowed: reasons.length === 0, reasons }
}

export function releaseFailureGuidance(errorCode?: string | null): string {
  switch (errorCode) {
    case "RELEASE_CONFLICT":
    case "MANIFEST_CONFLICT":
      return "生产 manifest 已变化。请刷新历史与快照，基于最新版本重新创建草稿。"
    case "RELEASE_TRANSACTION_ACTIVE":
      return "服务器已有发布事务。请等待该事务结束，再重新发布。"
    case "PLUGIN_OFFLINE":
    case "READINESS_TIMEOUT":
      return "插件未就绪。确认目标服务器在线、网络可达，并检查插件日志后重试。"
    case "RELEASE_ROLLBACK_CONFLICT":
      return "当前事务状态不允许回滚。请刷新事务状态并按服务端提示处理。"
    default:
      return "保留当前草稿，不要重复修改生产文件。请检查事务详情、服务器日志和 manifest 后重试。"
  }
}
