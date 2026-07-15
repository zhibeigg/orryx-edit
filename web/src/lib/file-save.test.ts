import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetAcknowledgedRevisionChainsForTests } from "@/lib/acknowledged-revision-chain"
import { resetEditorInputFlushRegistryForTests } from "@/lib/editor-input-flush"
import { resetFileOperationGuardsForTests } from "@/lib/file-operation-guard"

const mocks = vi.hoisted(() => ({
  fileWrite: vi.fn(),
  persistDraftSnapshot: vi.fn(() => Promise.resolve()),
  deleteDraftSnapshotIfUnchanged: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("@/lib/draft-consistency", () => ({
  persistDraftSnapshot: mocks.persistDraftSnapshot,
  persistDraftSnapshots: vi.fn(() => Promise.resolve()),
  deleteDraftSnapshotIfUnchanged: mocks.deleteDraftSnapshotIfUnchanged,
}))

vi.mock("@/lib/ws-client", () => {
  class WsRequestError extends Error {
    code: string
    data: Record<string, unknown>

    constructor(data: Record<string, unknown> = {}) {
      super(typeof data.message === "string" ? data.message : "请求失败")
      this.code = typeof data.code === "string" ? data.code : "REQUEST_FAILED"
      this.data = data
    }
  }
  return { wsClient: { fileWrite: mocks.fileWrite }, WsRequestError }
})

import { saveEditorFile } from "@/lib/file-save"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

const baseFile: OpenFile = {
  workspaceId: "workspace-a",
  path: "skills/fire.yml",
  name: "fire.yml",
  content: "server",
  configType: "skill",
  revision: "rev-a",
  dirty: false,
  draftVersion: 0,
}

function resetStore() {
  useEditorStore.setState({
    workspaceId: "workspace-a",
    openFiles: [baseFile],
    activeFilePath: baseFile.path,
    recentlyClosed: [],
    fileContents: new Map(),
    saveConflict: null,
    lifecycleError: null,
  })
}

describe("同文件连续保存 revision 继承", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAcknowledgedRevisionChainsForTests()
    resetEditorInputFlushRegistryForTests()
    resetFileOperationGuardsForTests()
    resetStore()
  })

  it("重连标记的外部 revision 会先进入冲突 UI，不向服务器发送旧域保存", async () => {
    const conflicted = {
      ...baseFile,
      content: "server-new",
      revision: "v2-new",
      externalRevision: "v2-new",
      draft: "local-draft",
      dirty: true,
      draftVersion: 2,
    }
    useEditorStore.setState({ openFiles: [conflicted], activeFilePath: conflicted.path })

    await expect(saveEditorFile(conflicted, "local-draft")).resolves.toBe(false)

    expect(mocks.fileWrite).not.toHaveBeenCalled()
    expect(useEditorStore.getState().saveConflict).toMatchObject({
      path: conflicted.path,
      currentRevision: "v2-new",
      attemptedContent: "local-draft",
    })
  })

  it("第二次调用固定旧 base，但排队开始时继承第一次成功确认的新 revision", async () => {
    let resolveFirst: ((value: { success: boolean; revision: string }) => void) | undefined
    mocks.fileWrite
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({ success: true, revision: "rev-c" })

    useEditorStore.getState().updateDraft(baseFile.path, "draft-one")
    const firstSnapshot = useEditorStore.getState().openFiles[0]
    const first = saveEditorFile(firstSnapshot, "draft-one")
    await vi.waitFor(() => expect(mocks.fileWrite).toHaveBeenCalledTimes(1))

    useEditorStore.getState().updateDraft(baseFile.path, "draft-two")
    const secondSnapshot = useEditorStore.getState().openFiles[0]
    expect(secondSnapshot.revision).toBe("rev-a")
    const second = saveEditorFile(secondSnapshot, "draft-two")

    resolveFirst?.({ success: true, revision: "rev-b" })
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)

    expect(mocks.fileWrite).toHaveBeenNthCalledWith(1, baseFile.path, "draft-one", "rev-a", false)
    expect(mocks.fileWrite).toHaveBeenNthCalledWith(2, baseFile.path, "draft-two", "rev-b", false)
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "draft-two",
      revision: "rev-c",
      dirty: false,
    })
  })
})
