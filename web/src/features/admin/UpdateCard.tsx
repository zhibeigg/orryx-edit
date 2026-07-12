import { AlertTriangle, Download, RefreshCw, RotateCw } from "lucide-react"
import { useUpdateJob } from "./useUpdateJob"
import type { UpdateJobStatus } from "./update-types"
import { zhCN } from "@/i18n/zh-CN"
import styles from "./UpdateCard.module.css"

const STATUS_TEXT: Record<UpdateJobStatus, string> = zhCN.update.status
const UPDATE_ERROR_TEXT: Record<string, string> = zhCN.update.errors

export function UpdateCard({ adminKey }: { adminKey: string }) {
  const { overview, job, errorCode, loading, refresh, start } = useUpdateJob(adminKey)
  const launcher = overview?.launcherManaged && overview.deployment === "launcher"
  const activeUsers = overview?.activeUsers ?? job?.activeUsers ?? 0
  const status = job ? STATUS_TEXT[job.status] : "空闲"
  const error = errorCode ?? job?.errorCode

  return (
    <section className={styles.card} aria-labelledby="update-card-title">
      <header className={styles.header}>
        <div><h2 id="update-card-title" className={styles.title}>在线更新</h2><p className={styles.subtitle}>仅接受经过版本、来源、清单与 SHA-256 校验的稳定版。</p></div>
        <button className={styles.button} type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} aria-hidden="true" /> 刷新</button>
      </header>

      <dl className={styles.grid}>
        <div><dt>当前版本</dt><dd>{overview?.currentVersion ?? "读取中…"}</dd></div>
        <div><dt>最新版本</dt><dd>{overview?.latestVersion ?? "尚未检查"}</dd></div>
        <div><dt>部署方式</dt><dd>{overview?.deployment ?? "读取中…"}</dd></div>
        <div><dt>任务状态</dt><dd>{status}</dd></div>
      </dl>

      {job && <div><progress className={styles.progress} max={100} value={job.progress} aria-label="更新进度" /><span>{job.progress}%</span></div>}
      {activeUsers > 0 && <p className={styles.warning}><AlertTriangle size={16} aria-hidden="true" /> 当前有 {activeUsers} 个活跃用户，应用更新会中断会话。</p>}
      {error && <p className={styles.error} role="alert">{UPDATE_ERROR_TEXT[error] ?? "更新任务失败，请联系管理员并提供错误码。"}（{error}）</p>}
      {!launcher && overview && <p className={styles.warning}>当前为 {overview.deployment} 部署，只允许检查版本；暂存与重启必须由 Orryx Launcher 管理。</p>}

      <div className={styles.actions}>
        <button className={styles.button} type="button" disabled={loading || Boolean(job && ["QUEUED", "CHECKING", "DOWNLOADING", "VERIFYING"].includes(job.status))} onClick={() => void start("CHECK")}><RefreshCw size={16} aria-hidden="true" /> 检查更新</button>
        <button className={`${styles.button} ${styles.primary}`} type="button" disabled={loading || !launcher || !overview?.updateAvailable} onClick={() => void start("STAGE")}><Download size={16} aria-hidden="true" /> 下载并暂存</button>
        <button className={styles.button} type="button" disabled={loading || !launcher || job?.status !== "STAGED" || activeUsers > 0} onClick={() => void start("APPLY")}><RotateCw size={16} aria-hidden="true" /> 暂存并请求重启</button>
      </div>
    </section>
  )
}
