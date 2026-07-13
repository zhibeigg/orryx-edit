export type KetherDocsHealth = "UP_TO_DATE" | "DEGRADED" | "FAILED"
export type KetherDocsSource = "REMOTE" | "CACHE" | "BUNDLED" | "NONE"

export interface KetherDocsStatus {
  enabled: boolean
  syncing: boolean
  health: KetherDocsHealth
  source: KetherDocsSource
  channel: "stable"
  releaseId?: string
  pluginVersion?: string
  commit?: string
  schemaVersion?: number
  schemaSha256?: string
  schemaBytes?: number
  publishedAt?: number
  lastAttemptAt?: number
  lastSuccessAt?: number
  nextAttemptAt?: number
  errorCode?: string
}

export interface KetherDocsApiError { code: string; message?: string }
