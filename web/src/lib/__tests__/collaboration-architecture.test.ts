import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), "utf8")

describe("可恢复 WebSocket 会话", () => {
  const client = source("../ws-client.ts")
  const connectPage = source("../../pages/ConnectPage.tsx")

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

  it("优先读取 fragment token 并在联网前清除 URL 凭据", () => {
    expect(connectPage).toContain('hashParams.get("token")')
    expect(connectPage).toContain("window.history.replaceState")
    expect(connectPage.indexOf("extractAndScrubUrlToken()")).toBeLessThan(connectPage.indexOf("handleConnect(urlToken)"))
  })
})

describe("workspace 草稿与 revision 冲突", () => {
  const drafts = source("../draft-storage.ts")
  const fileSave = source("../file-save.ts")
  const editorStore = source("../../store/editor-store.ts")

  it("IndexedDB 草稿键包含 workspaceId", () => {
    expect(drafts).toContain('const DRAFT_PREFIX = "draft:v2:"')
    expect(drafts).toContain("workspaceId")
    expect(drafts).toContain("currentWorkspaceId")
  })

  it("所有写入携带 base revision 并将冲突交给显式 UI", () => {
    expect(fileSave).toContain("file.revision")
    expect(fileSave).toContain('error.code === "REVISION_CONFLICT"')
    expect(editorStore).toContain("saveConflict")
    expect(editorStore).toContain("externalRevision")
  })
})
