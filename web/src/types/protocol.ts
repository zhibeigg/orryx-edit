// WebSocket 消息协议类型

export interface WsMessage<T = unknown> {
  type: string
  id: string
  data: T
}

// ---- 前端 → 服务器 ----

export interface AuthRequest {
  token?: string
  resumeToken?: string
}

export interface FileListRequest {
  path?: string
}

export interface FileReadRequest {
  path: string
}

export interface FileWriteRequest {
  path: string
  content: string
  baseRevision: number
  force?: boolean
}

export interface FileCreateRequest {
  path: string
  isDirectory: boolean
}

export interface FileDeleteRequest {
  path: string
}

export interface FileRenameRequest {
  oldPath: string
  newPath: string
}

export interface ReloadRequest {
  module: "skill" | "job" | "status" | "controller" | "buff" | "all"
}

export interface LogSubscribeRequest {
  filters?: {
    level?: string
    source?: string
    keyword?: string
  }
}

// ---- 服务器 → 前端 ----

export interface AuthResult {
  success: boolean
  permissions?: string[]
  serverName?: string
  onlineCount?: number
  workspaceId?: string
  browserId?: string
  playerName?: string
  resumeToken?: string
}

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

export interface FileTreeResponse {
  files: FileTreeNode[]
}

export interface FileContentResponse {
  path: string
  content: string
  revision: number
}

export interface FileWrittenResponse {
  path: string
  success: boolean
  revision?: number
  message?: string
}

export interface PresenceMember {
  browserId: string
  playerName: string
  currentFile?: string | null
  lastActiveAt: number
}

export interface PresenceUpdated {
  members: PresenceMember[]
}

export interface FileChanged {
  path: string
  revision: number
  browserId?: string
}

export interface ReloadResult {
  module: string
  success: boolean
  message?: string
}

export interface LogEntry {
  level: "INFO" | "WARN" | "ERROR" | "DEBUG"
  message: string
  timestamp: number
  source?: string
}

export interface ServerInfo {
  name: string
  version: string
  players: number
}

// 消息类型常量
export const MSG = {
  // 前端 → 服务器
  AUTH: "auth",
  FILE_LIST: "file.list",
  FILE_READ: "file.read",
  FILE_WRITE: "file.write",
  FILE_CREATE: "file.create",
  FILE_DELETE: "file.delete",
  FILE_RENAME: "file.rename",
  RELOAD: "reload",
  LOG_SUBSCRIBE: "log.subscribe",
  LOG_UNSUBSCRIBE: "log.unsubscribe",
  PRESENCE_UPDATE: "presence.update",

  // 服务器 → 前端
  AUTH_RESULT: "auth.result",
  FILE_TREE: "file.tree",
  FILE_CONTENT: "file.content",
  FILE_WRITTEN: "file.written",
  RELOAD_RESULT: "reload.result",
  LOG_ENTRY: "log.entry",
  SERVER_INFO: "server.info",
  PRESENCE_UPDATED: "presence.updated",
  FILE_CHANGED: "file.changed",
  ERROR: "error",
} as const
