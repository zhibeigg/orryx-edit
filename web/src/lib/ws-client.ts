import type { FileTreeNode, WsMessage } from "@/types"
import { MSG } from "@/types"
import type { RevisionToken } from "@/types/protocol"

export interface CollaboratorPresence {
  browserId: string
  playerName: string
  currentFile?: string | null
  lastActiveAt: number
}

export type NegotiatedProtocol = "v1" | "v2"

export interface RelayServerInfo {
  online: boolean
  workspaceId: string
  serverId: string
  serverName?: string
  negotiatedProtocol: NegotiatedProtocol
  sessionEpoch: number
  relayCapabilities: string[]
}

export interface AuthSession {
  success: boolean
  code?: string
  permissions?: string[]
  serverName?: string
  serverId?: string
  onlineCount?: number
  workspaceId?: string
  browserId?: string
  playerName?: string
  resumeToken?: string
  negotiatedProtocol?: NegotiatedProtocol
  sessionEpoch?: number
  relayCapabilities?: string[]
  collaborators?: CollaboratorPresence[]
  message?: string
}

export interface FileReadResult {
  path: string
  content: string
  revision: RevisionToken
}

export interface FileWriteResult {
  path: string
  success: boolean
  revision: RevisionToken
}

export interface WsErrorData {
  code?: string
  message?: string
  path?: string
  currentRevision?: RevisionToken
  [key: string]: unknown
}

export class WsRequestError extends Error {
  readonly code: string
  readonly data: WsErrorData

  constructor(data: WsErrorData = {}) {
    super(data.message ?? "请求失败")
    this.name = "WsRequestError"
    this.code = data.code ?? "REQUEST_FAILED"
    this.data = data
  }
}

export function isPermanentAuthenticationError(error: unknown): error is WsRequestError {
  return error instanceof WsRequestError && PERMANENT_AUTHENTICATION_ERROR_CODES.has(error.code)
}

type MessageHandler = (msg: WsMessage) => void
type PendingRequest = {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const RESUME_TOKEN_KEY = "orryx.resumeToken"
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
const PERMANENT_AUTHENTICATION_ERROR_CODES = new Set([
  "INVALID_SESSION",
  "INVALID_RESUME_TOKEN",
  "SESSION_EXPIRED",
  "LICENSE_INACTIVE",
])

let socket: WebSocket | null = null
let connectionPromise: Promise<void> | null = null
let connectionUrl: string | null = null
let messageId = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let manuallyClosed = false
let authenticated = false
let resumeBlockedUntilReload = false
let resumeToken: string | null = sessionStorage.getItem(RESUME_TOKEN_KEY)

const pendingRequests = new Map<string, PendingRequest>()
const listeners = new Map<string, Set<MessageHandler>>()
let onStatusChange: ((connected: boolean) => void) | null = null
let onReconnectFailed: ((error: WsRequestError) => void) | null = null
let onReconnected: ((session: AuthSession) => void) | null = null
let onAuthenticationLost: ((error: WsRequestError) => void) | null = null

function nextId(): string {
  messageId += 1
  return `req_${messageId}_${Date.now()}`
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function rejectPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  pendingRequests.clear()
}

function persistResumeToken(value: string | null) {
  resumeToken = value
  if (value) sessionStorage.setItem(RESUME_TOKEN_KEY, value)
  else sessionStorage.removeItem(RESUME_TOKEN_KEY)
}

function loseAuthentication(error: WsRequestError) {
  authenticated = false
  resumeBlockedUntilReload = false
  persistResumeToken(null)
  onAuthenticationLost?.(error)
}

function dispatchMessage(msg: WsMessage) {
  const typeListeners = listeners.get(msg.type)
  if (!typeListeners) return
  for (const handler of typeListeners) handler(msg)
}

function handleIncomingMessage(event: MessageEvent) {
  try {
    const msg = JSON.parse(String(event.data)) as WsMessage<WsErrorData>
    if (msg.id) {
      const pending = pendingRequests.get(msg.id)
      if (pending) {
        pendingRequests.delete(msg.id)
        clearTimeout(pending.timeout)
        if (msg.type === MSG.ERROR) pending.reject(new WsRequestError(msg.data))
        else pending.resolve(msg.data)
        return
      }
    }
    dispatchMessage(msg)
  } catch {
    console.error("解析 WebSocket 消息失败")
  }
}

function websocketUrl(): string {
  if (connectionUrl) return connectionUrl
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}/ws`
}

function scheduleReconnect() {
  if (manuallyClosed || !authenticated || !resumeToken || reconnectTimer) return
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    authenticated = false
    resumeBlockedUntilReload = true
    manuallyClosed = true
    onReconnectFailed?.(new WsRequestError({
      code: "RECONNECT_ATTEMPTS_EXHAUSTED",
      message: "恢复连接重试次数已耗尽",
    }))
    return
  }

  const exponential = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS)
  const jitteredDelay = Math.round(exponential * (0.8 + Math.random() * 0.4))
  reconnectAttempts += 1

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try {
      await connect(websocketUrl())
      const session = await authenticateResume()
      reconnectAttempts = 0
      onReconnected?.(session)
    } catch (error) {
      if (isPermanentAuthenticationError(error)) {
        disconnect(false)
        return
      }
      scheduleReconnect()
    }
  }, jitteredDelay)
}

export function setStatusChangeHandler(handler: (connected: boolean) => void) {
  onStatusChange = handler
}

export function setReconnectedHandler(handler: (session: AuthSession) => void) {
  onReconnected = handler
}

export function setReconnectFailedHandler(handler: (error: WsRequestError) => void) {
  onReconnectFailed = handler
}

export function setAuthenticationLostHandler(handler: (error: WsRequestError) => void) {
  onAuthenticationLost = handler
}

export function connect(url = websocketUrl()): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve()
  if (socket?.readyState === WebSocket.CONNECTING && connectionPromise) return connectionPromise

  manuallyClosed = false
  connectionUrl = url
  clearReconnectTimer()

  connectionPromise = new Promise((resolve, reject) => {
    const nextSocket = new WebSocket(url)
    socket = nextSocket
    let settled = false

    nextSocket.onopen = () => {
      if (socket !== nextSocket) return
      settled = true
      onStatusChange?.(true)
      resolve()
    }

    nextSocket.onmessage = handleIncomingMessage

    nextSocket.onerror = () => {
      if (!settled) reject(new Error("WebSocket 连接失败"))
    }

    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = null
      connectionPromise = null
      onStatusChange?.(false)
      rejectPendingRequests(new Error("WebSocket 连接已断开"))
      if (!settled) reject(new Error("WebSocket 连接失败"))
      scheduleReconnect()
    }
  })

  return connectionPromise
}

export function disconnect(clearSession = true) {
  manuallyClosed = true
  authenticated = false
  clearReconnectTimer()
  rejectPendingRequests(new Error("WebSocket 连接已关闭"))
  if (clearSession) {
    resumeBlockedUntilReload = false
    persistResumeToken(null)
  }
  const current = socket
  socket = null
  connectionPromise = null
  current?.close()
  onStatusChange?.(false)
}

export function request<T = unknown>(type: string, data: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket 未连接"))
      return
    }

    const id = nextId()
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      pending.reject(new Error(`请求超时: ${type}`))
    }, REQUEST_TIMEOUT_MS)

    pendingRequests.set(id, {
      resolve: resolve as (data: unknown) => void,
      reject,
      timeout,
    })

    try {
      socket.send(JSON.stringify({ type, id, data } satisfies WsMessage))
    } catch (error) {
      clearTimeout(timeout)
      pendingRequests.delete(id)
      reject(error instanceof Error ? error : new Error("发送 WebSocket 消息失败"))
    }
  })
}

export function send(type: string, data: unknown = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify({ type, id: nextId(), data } satisfies WsMessage))
  return true
}

export function on(type: string, handler: MessageHandler): () => void {
  const handlers = listeners.get(type) ?? new Set<MessageHandler>()
  handlers.add(handler)
  listeners.set(type, handlers)
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0) listeners.delete(type)
  }
}

async function applyAuthResult(result: AuthSession): Promise<AuthSession> {
  if (!result.success) throw new WsRequestError({ code: result.code ?? "AUTH_FAILED", message: result.message ?? "认证失败" })
  authenticated = true
  resumeBlockedUntilReload = false
  if (result.resumeToken) persistResumeToken(result.resumeToken)
  return result
}

async function authenticateResume(): Promise<AuthSession> {
  if (resumeBlockedUntilReload) {
    throw new WsRequestError({ code: "RECONNECT_RELOAD_REQUIRED", message: "请刷新页面后恢复编辑会话" })
  }
  if (!resumeToken) throw new WsRequestError({ code: "INVALID_SESSION", message: "没有可恢复会话" })
  try {
    return await applyAuthResult(await request<AuthSession>(MSG.AUTH, { resumeToken }))
  } catch (error) {
    if (isPermanentAuthenticationError(error)) loseAuthentication(error)
    throw error
  }
}

export const wsClient = {
  connect,
  disconnect,
  request,
  send,
  on,
  setStatusChangeHandler,
  setReconnectedHandler,
  setReconnectFailedHandler,
  setAuthenticationLostHandler,

  hasResumeSession() {
    return Boolean(resumeToken) && !resumeBlockedUntilReload
  },

  clearResumeSession() {
    resumeBlockedUntilReload = false
    persistResumeToken(null)
  },

  async auth(token: string) {
    const result = await applyAuthResult(await request<AuthSession>(MSG.AUTH, { token }))
    reconnectAttempts = 0
    return result
  },

  async resume() {
    const result = await authenticateResume()
    reconnectAttempts = 0
    return result
  },

  async fileList(path?: string) {
    return request<{ files: FileTreeNode[] }>(MSG.FILE_LIST, { path })
  },

  async fileRead(path: string) {
    return request<FileReadResult>(MSG.FILE_READ, { path })
  },

  async fileWrite(path: string, content: string, baseRevision: RevisionToken, force = false) {
    return request<FileWriteResult>(MSG.FILE_WRITE, { path, content, baseRevision, force })
  },

  async fileCreate(path: string, isDirectory = false) {
    return request<{ path: string; success: boolean; revision?: RevisionToken }>(MSG.FILE_CREATE, { path, isDirectory })
  },

  async fileDelete(path: string) {
    return request<{ path: string; success: boolean }>(MSG.FILE_DELETE, { path })
  },

  async fileRename(oldPath: string, newPath: string) {
    return request<{ success: boolean }>(MSG.FILE_RENAME, { oldPath, newPath })
  },

  async reload(module: string) {
    return request<{ module: string; success: boolean; message?: string }>(MSG.RELOAD, { module })
  },

  updatePresence(currentFile: string | null) {
    send(MSG.PRESENCE_UPDATE, { currentFile })
  },
}
