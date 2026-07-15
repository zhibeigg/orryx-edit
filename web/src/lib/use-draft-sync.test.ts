import { describe, expect, it } from "vitest"
import { restoreDraftAgainstServer } from "@/lib/use-draft-sync"

describe("workspace 草稿恢复 revision 配对", () => {
  it("保留草稿原始 base content/revision，并把新服务器 revision 标为外部变化", () => {
    const restored = restoreDraftAgainstServer({
      workspaceId: "workspace-a",
      content: "local draft",
      baseContent: "old server",
      baseRevision: "rev-old",
      draftVersion: 7,
      savedAt: 1,
    }, "new server", "rev-new")

    expect(restored).toEqual({
      content: "local draft",
      serverContent: "old server",
      baseRevision: "rev-old",
      draftVersion: 7,
      externalRevision: "rev-new",
      hasDraft: true,
    })
  })

  it("持久化的冲突标记在 revision 域已刷新后仍阻止静默保存", () => {
    expect(restoreDraftAgainstServer({
      workspaceId: "workspace-a",
      content: "local draft",
      baseContent: "server",
      baseRevision: "v2-current",
      draftVersion: 3,
      requiresConflictResolution: true,
      savedAt: 1,
    }, "server", "v2-current")).toMatchObject({
      content: "local draft",
      baseRevision: "v2-current",
      externalRevision: "v2-current",
      hasDraft: true,
    })
  })

  it("无差异草稿直接采用当前服务器快照", () => {
    expect(restoreDraftAgainstServer(null, "server", "rev-current")).toEqual({
      content: "server",
      serverContent: "server",
      baseRevision: "rev-current",
      draftVersion: 0,
      hasDraft: false,
    })
  })
})
