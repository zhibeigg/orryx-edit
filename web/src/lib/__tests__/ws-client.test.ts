import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface SentMessage {
  type: string
  id: string
  data: Record<string, unknown>
}

class MemorySessionStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []
  static autoFail = false
  static respond: (message: SentMessage) => Record<string, unknown> = () => ({ success: true })

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    if (FakeWebSocket.autoFail) queueMicrotask(() => this.fail())
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  send(raw: string) {
    const message = JSON.parse(raw) as SentMessage
    const data = FakeWebSocket.respond(message)
    queueMicrotask(() => this.onmessage?.({
      data: JSON.stringify({ type: "auth.result", id: message.id, data }),
    }))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  private fail() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.onerror?.()
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

async function loadClient(initialResumeToken = "resume-token") {
  const storage = new MemorySessionStorage()
  if (initialResumeToken) storage.setItem("orryx.resumeToken", initialResumeToken)
  vi.stubGlobal("sessionStorage", storage)
  vi.stubGlobal("window", {
    location: { protocol: "https:", host: "editor.example.com" },
  })
  vi.stubGlobal("WebSocket", FakeWebSocket)
  vi.resetModules()
  const module = await import("@/lib/ws-client")
  return { ...module, storage }
}

async function openInitialConnection(wsClient: { connect: (url: string) => Promise<void> }) {
  const connecting = wsClient.connect("wss://editor.example.com/ws")
  const socket = FakeWebSocket.instances.at(-1)
  expect(socket).toBeDefined()
  socket?.open()
  await connecting
  return socket as FakeWebSocket
}

describe("ws-client resume 认证生命周期", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    FakeWebSocket.autoFail = false
    FakeWebSocket.respond = () => ({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("INVALID_RESUME_TOKEN 会清除 token 并调用 authenticationLost", async () => {
    const { wsClient, WsRequestError, storage } = await loadClient()
    await openInitialConnection(wsClient)
    FakeWebSocket.respond = () => ({
      success: false,
      code: "INVALID_RESUME_TOKEN",
      message: "Resume token 无效或已过期",
    })
    const authenticationLost = vi.fn()
    wsClient.setAuthenticationLostHandler(authenticationLost)

    await expect(wsClient.resume()).rejects.toMatchObject({ code: "INVALID_RESUME_TOKEN" })

    expect(storage.getItem("orryx.resumeToken")).toBeNull()
    expect(wsClient.hasResumeSession()).toBe(false)
    expect(authenticationLost).toHaveBeenCalledOnce()
    expect(authenticationLost.mock.calls[0][0]).toBeInstanceOf(WsRequestError)
    expect(authenticationLost.mock.calls[0][0]).toMatchObject({ code: "INVALID_RESUME_TOKEN" })
    wsClient.disconnect(false)
  })

  it("重连耗尽会明确失败、保留持久化 token 并阻止本页自动 resume", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
    const { wsClient, storage } = await loadClient()
    const initialSocket = await openInitialConnection(wsClient)
    FakeWebSocket.respond = () => ({
      success: true,
      workspaceId: "workspace-a",
      browserId: "browser-a",
      playerName: "Steve",
      resumeToken: "rotated-token",
    })
    await wsClient.resume()

    const reconnectFailed = vi.fn()
    wsClient.setReconnectFailedHandler(reconnectFailed)
    FakeWebSocket.autoFail = true
    initialSocket.close()
    await vi.runAllTimersAsync()

    expect(reconnectFailed).toHaveBeenCalledOnce()
    expect(reconnectFailed.mock.calls[0][0]).toMatchObject({ code: "RECONNECT_ATTEMPTS_EXHAUSTED" })
    expect(storage.getItem("orryx.resumeToken")).toBe("rotated-token")
    expect(wsClient.hasResumeSession()).toBe(false)
  })
})
