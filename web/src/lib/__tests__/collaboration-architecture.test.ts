import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), "utf8")

describe("可恢复 WebSocket 会话", () => {
  const client = source("../ws-client.ts")
  const connectPage = source("../../pages/ConnectPage.tsx")
  const connectionCredential = source("../connection-credential.ts")
  const connectionStore = source("../../store/connection-store.ts")

  it("一次性 token 与 resume token 分离且认证后才重置重试次数", () => {
    expect(client).toContain('const RESUME_TOKEN_KEY = "orryx.resumeToken"')
    expect(client).toContain("{ resumeToken }")
    expect(client).toContain("async auth(token: string)")
    expect(client).not.toMatch(/onopen[\s\S]{0,180}reconnectAttempts = 0/)
  })

  it("请求完成、超时与断线都会清理 timeout", () => {
    expect(client).toContain("clearTimeout(pending.timeout)")
    expect(client).toContain("pendingRequests.delete(id)")
    expect(client).toContain("rejectPendingRequests")
  })

  it("只读取 fragment token，并在联网前清除地址栏凭据", () => {
    expect(connectionCredential).toContain('hashParams.get("token")')
    expect(connectionCredential).toContain("window.history.replaceState")
    expect(connectionCredential).toContain("url.hash = \"\"")
    expect(connectionCredential).not.toContain('url.searchParams.get("token")')
    expect(connectPage.indexOf("const credential = extractAndScrubUrlToken()")).toBeLessThan(connectPage.indexOf("void handleConnect(credential.token)"))
  })

  it("查询参数 token 被拒绝，且一次性 token 不进入全局 store 或输入框", () => {
    expect(connectionCredential).toContain('url.searchParams.has("token")')
    expect(connectionCredential).toContain("rejectedQueryToken ? null : fragmentToken")
    expect(connectPage).not.toContain("tokenInput")
    expect(connectPage).not.toContain("setToken")
    expect(connectionStore).not.toMatch(/\btoken:/)
    expect(connectionStore).not.toContain("setToken")
  })
})

describe("workspace 草稿与 revision 冲突", () => {
  const drafts = source("../draft-storage.ts")
  const fileSave = source("../file-save.ts")
  const editorStore = source("../../store/editor-store.ts")

  it("IndexedDB 草稿键显式包含 workspaceId，且不会回退到 unbound", () => {
    expect(drafts).toContain('const DRAFT_PREFIX = "draft:v2:"')
    expect(drafts).toContain("workspaceId")
    expect(drafts).not.toContain("currentWorkspaceId")
    expect(drafts).not.toContain('"unbound"')
  })

  it("所有写入使用调用时捕获的 base revision，并将冲突交给显式 UI", () => {
    expect(fileSave).toContain("captureFileSaveSnapshot")
    expect(fileSave).toContain("snapshot.baseRevision")
    expect(fileSave).toContain('error.code === "REVISION_CONFLICT"')
    expect(editorStore).toContain("saveConflict")
    expect(editorStore).toContain("externalRevision")
  })
})
