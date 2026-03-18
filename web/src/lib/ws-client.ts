import type { WsMessage } from "@/types"
import { MSG } from "@/types"

type MessageHandler = (msg: WsMessage) => void

let ws: WebSocket | null = null
let messageId = 0
const pendingRequests = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>()
const listeners = new Map<string, Set<MessageHandler>>()
let onStatusChange: ((connected: boolean) => void) | null = null
let onReconnectFailed: (() => void) | null = null
let onReconnected: ((serverName?: string) => void) | null = null

// 重连状态
let reconnectUrl: string | null = null
let reconnectToken: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY = 1000

function nextId(): string {
  return `req_${++messageId}_${Date.now()}`
}

export function setStatusChangeHandler(handler: (connected: boolean) => void) {
  onStatusChange = handler
}

export function setReconnectedHandler(handler: (serverName?: string) => void) {
  onReconnected = handler
}

export function setReconnectFailedHandler(handler: () => void) {
  onReconnectFailed = handler
}

function scheduleReconnect() {
  if (!reconnectUrl || !reconnectToken) return
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn("已达最大重连次数，停止重连")
    onReconnectFailed?.()
    return
  }

  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), 30000)
  reconnectAttempts++
  console.log(`将在 ${delay}ms 后尝试第 ${reconnectAttempts} 次重连...`)

  reconnectTimer = setTimeout(async () => {
    try {
      await connect(reconnectUrl!)
      // 重连成功，自动重新认证
      const authResult = await request<{ success: boolean; serverName?: string }>(MSG.AUTH, { token: reconnectToken })
      if (authResult.success) {
        reconnectAttempts = 0
        onReconnected?.(authResult.serverName)
      }
    } catch {
      scheduleReconnect()
    }
  }, delay)
}

export function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws?.readyState === WebSocket.OPEN) {
      resolve()
      return
    }

    reconnectUrl = url
    ws = new WebSocket(url)

    ws.onopen = () => {
      onStatusChange?.(true)
      reconnectAttempts = 0
      resolve()
    }

    ws.onclose = () => {
      onStatusChange?.(false)
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error("WebSocket 连接已断开"))
      }
      pendingRequests.clear()
      // 如果有 token，尝试自动重连
      if (reconnectToken) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      reject(new Error("WebSocket 连接失败"))
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)

        if (msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)
          if (!pending) return
          pendingRequests.delete(msg.id)
          pending.resolve(msg.data)
          return
        }

        const typeListeners = listeners.get(msg.type)
        if (typeListeners) {
          for (const handler of typeListeners) {
            handler(msg)
          }
        }
      } catch {
        console.error("解析 WebSocket 消息失败:", event.data)
      }
    }
  })
}

export function disconnect() {
  reconnectToken = null // 清除 token 阻止自动重连
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  ws?.close()
  ws = null
}

/** 发送请求并等待响应 */
export function request<T = unknown>(type: string, data: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket 未连接"))
      return
    }

    const id = nextId()
    const msg: WsMessage = { type, id, data }

    pendingRequests.set(id, {
      resolve: resolve as (data: unknown) => void,
      reject,
    })

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`请求超时: ${type}`))
      }
    }, 10000)

    ws.send(JSON.stringify(msg))
  })
}

/** 发送消息（不等待响应） */
export function send(type: string, data: unknown = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const msg: WsMessage = { type, id: nextId(), data }
  ws.send(JSON.stringify(msg))
}

/** 监听特定类型的消息 */
export function on(type: string, handler: MessageHandler): () => void {
  if (!listeners.has(type)) {
    listeners.set(type, new Set())
  }
  listeners.get(type)!.add(handler)
  return () => listeners.get(type)?.delete(handler)
}

// 便捷 API
export const wsClient = {
  connect,
  disconnect,
  request,
  send,
  on,
  setStatusChangeHandler,
  setReconnectedHandler,
  setReconnectFailedHandler,

  async auth(token: string) {
    reconnectToken = token // 记录 token 用于自动重连
    return request<{ success: boolean; permissions?: string[]; serverName?: string }>(MSG.AUTH, { token })
  },

  async fileList(path?: string) {
    return request<{ files: import("@/types").FileTreeNode[] }>(MSG.FILE_LIST, { path })
  },

  async fileRead(path: string) {
    return request<{ path: string; content: string }>(MSG.FILE_READ, { path })
  },

  async fileWrite(path: string, content: string) {
    return request<{ path: string; success: boolean }>(MSG.FILE_WRITE, { path, content })
  },

  async fileCreate(path: string, isDirectory = false) {
    return request<{ path: string; success: boolean }>(MSG.FILE_CREATE, { path, isDirectory })
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
}
