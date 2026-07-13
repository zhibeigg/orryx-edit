import { BookOpenCheck, Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
import { zhCN } from "@/i18n/zh-CN"
import { useKetherDocsSync } from "./useKetherDocsSync"
import type { KetherDocsHealth, KetherDocsSource } from "./kether-docs-types"
import styles from "./KetherDocsCard.module.css"

const HEALTH_TEXT: Record<KetherDocsHealth, string> = zhCN.ketherDocs.health
const SOURCE_TEXT: Record<KetherDocsSource, string> = zhCN.ketherDocs.source
const ERROR_TEXT: Record<string, string> = zhCN.ketherDocs.errors

export function KetherDocsCard({ adminKey }: { adminKey: string }) {
  const { status, errorCode, loading, refresh, synchronize } = useKetherDocsSync(adminKey)
  const effectiveError = errorCode ?? status?.errorCode
  const health = status?.health ?? "DEGRADED"
  const busy = loading || Boolean(status?.syncing)

  return (
    <section className={styles.card} aria-labelledby="kether-docs-card-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true"><BookOpenCheck /></span>
          <div>
            <h2 id="kether-docs-card-title">Kether 文档同步</h2>
            <p>仅从 Orryx 官方 stable 通道接收经过版本、路径、大小与 SHA-256 校验的 Schema。</p>
          </div>
        </div>
        <span className={`${styles.health} ${styles[`health${health}`]}`}>
          {health === "UP_TO_DATE" ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          {status ? HEALTH_TEXT[health] : "读取中"}
        </span>
      </header>

      <dl className={styles.grid}>
        <Metric label="Orryx 版本" value={status?.pluginVersion ?? "等待首次同步"} />
        <Metric label="Schema 契约" value={status?.schemaVersion ? `v${status.schemaVersion}` : "未知"} />
        <Metric label="当前来源" value={status ? SOURCE_TEXT[status.source] : "读取中"} />
        <Metric label="通道" value={status?.channel ?? "stable"} />
        <Metric label="最近成功" value={formatTime(status?.lastSuccessAt)} />
        <Metric label="下次检查" value={formatTime(status?.nextAttemptAt)} />
      </dl>

      <div className={styles.integrity}>
        <Database aria-hidden="true" />
        <div>
          <span>完整性</span>
          <code>{formatHash(status?.schemaSha256)}</code>
        </div>
        <small>{formatBytes(status?.schemaBytes)} · {shortCommit(status?.commit)}</small>
      </div>

      {effectiveError && (
        <p className={health === "FAILED" ? styles.error : styles.warning} role="status">
          <TriangleAlert aria-hidden="true" />
          <span>{ERROR_TEXT[effectiveError] ?? zhCN.ketherDocs.errors.KETHER_DOCS_REQUEST_FAILED}（{effectiveError}）</span>
        </p>
      )}

      <footer className={styles.footer}>
        <p>新打开或刷新的编辑会话会读取当前 Schema；已打开的会话不会在中途切换。</p>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw aria-hidden="true" />刷新状态
          </button>
          <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void synchronize()} disabled={busy || status?.enabled === false}>
            <RefreshCw className={busy ? styles.spinning : undefined} aria-hidden="true" />
            {busy ? "同步中…" : "立即同步 stable"}
          </button>
        </div>
      </footer>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function formatTime(value?: number): string {
  if (!value) return "尚无记录"
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
}

function formatHash(value?: string): string {
  if (!value) return "SHA-256 尚未载入"
  return `${value.slice(0, 16)}…${value.slice(-8)}`
}

function shortCommit(value?: string): string {
  return value ? `commit ${value.slice(0, 12)}` : "commit 未知"
}

function formatBytes(value?: number): string {
  if (!value) return "大小未知"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(2)} MiB`
}
