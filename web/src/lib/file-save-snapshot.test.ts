import { describe, expect, it } from "vitest"
import { captureFileSaveSnapshot, fileSaveQueueKey } from "@/lib/file-save-snapshot"
import type { OpenFile } from "@/store/editor-store"

const file: OpenFile = {
  workspaceId: "workspace-a",
  path: "skills/fire.yml",
  name: "fire.yml",
  content: "server",
  draft: "draft-one",
  configType: "skill",
  revision: "rev-a",
  dirty: true,
  draftVersion: 3,
}

describe("保存因果快照", () => {
  it("队列键同时包含 workspace 与 path", () => {
    expect(fileSaveQueueKey("workspace-a", "skills/fire.yml")).toBe("workspace-a:skills/fire.yml")
    expect(fileSaveQueueKey("workspace-b", "skills/fire.yml")).not.toBe(fileSaveQueueKey("workspace-a", "skills/fire.yml"))
  })

  it("调用时一次性捕获 content、draftVersion 与 baseRevision", () => {
    const snapshot = captureFileSaveSnapshot(file, "draft-one")
    const laterFile = { ...file, revision: "rev-b", draftVersion: 4, draft: "draft-two" }

    expect(laterFile).toMatchObject({ revision: "rev-b", draftVersion: 4 })
    expect(snapshot).toEqual({
      workspaceId: "workspace-a",
      path: "skills/fire.yml",
      content: "draft-one",
      baseRevision: "rev-a",
      draftVersion: 3,
      force: false,
    })
  })
})
