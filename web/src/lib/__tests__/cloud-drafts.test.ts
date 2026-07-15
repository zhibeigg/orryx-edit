import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { saveCurrentFileToCloudDraftVersion } from "@/lib/cloud-drafts"
import type { OpenFile } from "@/store/editor-store"

const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  vi.restoreAllMocks()
})

describe("云端草稿版本隔离", () => {
  it("显式保存当前内容只调用 drafts HTTP API，不触发 WebSocket/file.write", async () => {
    const websocketConstructor = vi.fn(() => {
      throw new Error("不应创建 WebSocket")
    })
    globalThis.WebSocket = websocketConstructor as unknown as typeof WebSocket
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "version-2",
      draftId: "draft-1",
      versionNumber: 2,
      source: "MANUAL",
      createdAt: "2026-01-01T00:00:00Z",
    }), { status: 200 }))
    globalThis.fetch = fetchMock

    const file: OpenFile = {
      workspaceId: "workspace-a",
      path: "skills/fire.yml",
      name: "fire.yml",
      content: "old: true",
      draft: "new: true",
      configType: "skill",
      revision: 7,
      dirty: true,
    }
    await saveCurrentFileToCloudDraftVersion("draft-1", 1, file)

    expect(websocketConstructor).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/v2/drafts/draft-1/versions")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedCurrentVersion: 1,
      source: "MANUAL",
      files: [{
        changeType: "UPSERT",
        path: "skills/fire.yml",
        baseRevision: "7",
        content: "new: true",
      }],
    })
  })

  it("云草稿与 AI 客户端不依赖插件写入或 reload", () => {
    for (const file of ["../cloud-drafts.ts", "../ai-jobs.ts"]) {
      const source = readFileSync(resolve(__dirname, file), "utf8")
      expect(source).not.toMatch(/wsClient|fileWrite|file\.write|\.reload\s*\(/)
    }
  })
})
