export type UpdateJobAction = "CHECK" | "STAGE" | "APPLY"
export type UpdateJobStatus = "QUEUED" | "CHECKING" | "DOWNLOADING" | "VERIFYING" | "STAGED" | "RESTART_PENDING" | "SUCCEEDED" | "FAILED"

export interface UpdateJob {
  id: string
  action: UpdateJobAction
  status: UpdateJobStatus
  progress: number
  currentVersion: string
  latestVersion?: string
  deployment: string
  activeUsers: number
  errorCode?: string
  createdAt: number
  updatedAt: number
}

export interface UpdateOverview {
  currentVersion: string
  latestVersion?: string
  deployment: string
  launcherManaged: boolean
  updateAvailable: boolean
  activeUsers: number
  job?: UpdateJob
}

export interface UpdateApiError { code: string; message?: string }
