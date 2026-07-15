import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  acknowledgeSavedRevision,
  resetAcknowledgedRevisionChainsForTests,
  resolveAcknowledgedSaveRevision,
} from "@/lib/acknowledged-revision-chain"
import { fileSaveQueueKey } from "@/lib/file-save-snapshot"
import { resetEditorInputFlushRegistryForTests } from "@/lib/editor-input-flush"

const draftMocks = vi.hoisted(() => ({
  persistDraftSnapshots: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/draft-consistency", () => draftMocks)

import { useEditorStore } from "@/store/editor-store"

function resetStore(workspaceId: string | null = null) {
  useEditorStore.setState({
    workspaceId,
    openFiles: [],
    activeFilePath: null,
    recentlyClosed: [],
    fileContents: new Map(),
    saveConflict: null,
    lifecycleError: null,
  })
}

function openFile(revision = "rev-a") {
  expect(useEditorStore.getState().openFile({
    workspaceId: "workspace-a",
    path: "skills/fire.yml",
    name: "fire.yml",
    content: "server",
    configType: "skill",
    revision,
  })).toBe(true)
}

function makeDirty(content = "dirty") {
  openFile()
  useEditorStore.getState().updateDraft("skills/fire.yml", content)
}

describe("editor workspace 生命周期", () => {
  beforeEach(() => {
    resetEditorInputFlushRegistryForTests()
    resetAcknowledgedRevisionChainsForTests()
    resetStore()
    draftMocks.persistDraftSnapshots.mockReset()
    draftMocks.persistDraftSnapshots.mockResolvedValue(undefined)
  })

  it("workspace 切换 await 旧 workspace 草稿持久化后才清空状态", async () => {
    resetStore("workspace-a")
    makeDirty()
    useEditorStore.getState().cacheFileContent("workspace-a", "skills/other.yml", "cached")
    useEditorStore.getState().setSaveConflict({
      workspaceId: "workspace-a",
      path: "skills/fire.yml",
      attemptedContent: "dirty",
      currentRevision: "rev-b",
      attemptedDraftVersion: 1,
    })

    await expect(useEditorStore.getState().setWorkspace("workspace-b")).resolves.toBe(true)

    expect(draftMocks.persistDraftSnapshots).toHaveBeenCalledWith("workspace-a", [expect.objectContaining({ draft: "dirty" })])
    expect(useEditorStore.getState()).toMatchObject({
      workspaceId: "workspace-b",
      openFiles: [],
      activeFilePath: null,
      recentlyClosed: [],
      saveConflict: null,
      lifecycleError: null,
    })
    expect(useEditorStore.getState().fileContents.size).toBe(0)
  })

  it("关闭文件会 await debounce 窗口内的最后 dirty 快照", async () => {
    resetStore("workspace-a")
    makeDirty("last dirty content")

    await expect(useEditorStore.getState().closeFile("skills/fire.yml")).resolves.toBe(true)
    expect(draftMocks.persistDraftSnapshots).toHaveBeenCalledWith(
      "workspace-a",
      [expect.objectContaining({ path: "skills/fire.yml", draft: "last dirty content", revision: "rev-a" })],
    )
    expect(useEditorStore.getState().openFiles).toEqual([])
  })

  it("单文件草稿写入失败会阻止关闭并保留可处理错误", async () => {
    resetStore("workspace-a")
    makeDirty("must survive")
    draftMocks.persistDraftSnapshots.mockRejectedValueOnce(new Error("quota exceeded"))

    await expect(useEditorStore.getState().closeFile("skills/fire.yml")).resolves.toBe(false)
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ draft: "must survive", dirty: true })
    expect(useEditorStore.getState().lifecycleError).toContain("草稿写入浏览器存储失败")
  })

  it("全部关闭在任一草稿写入失败时不移除任何标签", async () => {
    resetStore("workspace-a")
    makeDirty("all must survive")
    draftMocks.persistDraftSnapshots.mockRejectedValueOnce(new Error("storage blocked"))

    await expect(useEditorStore.getState().closeAllFiles()).resolves.toBe(false)
    expect(useEditorStore.getState().openFiles).toHaveLength(1)
    expect(useEditorStore.getState().activeFilePath).toBe("skills/fire.yml")
  })

  it("workspace 草稿写入失败会阻止破坏性切换", async () => {
    resetStore("workspace-a")
    makeDirty("workspace draft")
    draftMocks.persistDraftSnapshots.mockRejectedValueOnce(new Error("storage blocked"))

    await expect(useEditorStore.getState().setWorkspace("workspace-b")).resolves.toBe(false)
    expect(useEditorStore.getState()).toMatchObject({
      workspaceId: "workspace-a",
      activeFilePath: "skills/fire.yml",
    })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ draft: "workspace draft", dirty: true })
  })

  it("外部 file.changed 会保留冲突标记并切断本地 revision 链", () => {
    resetStore("workspace-a")
    openFile("rev-a")
    const key = fileSaveQueueKey("workspace-a", "skills/fire.yml")
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-b")

    useEditorStore.getState().markExternalChange("workspace-a", "skills/fire.yml", "rev-external")

    expect(useEditorStore.getState().openFiles[0].externalRevision).toBe("rev-external")
    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-a")
  })

  it("重新打开已 dirty 文件不会把后来读取的 revision 塞到旧草稿下", () => {
    resetStore("workspace-a")
    openFile("rev-old")
    useEditorStore.getState().updateDraft("skills/fire.yml", "local draft")

    useEditorStore.getState().openFile({
      workspaceId: "workspace-a",
      path: "skills/fire.yml",
      name: "fire.yml",
      content: "new server",
      configType: "skill",
      revision: "rev-new",
    })

    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "server",
      revision: "rev-old",
      draft: "local draft",
      dirty: true,
    })
  })
})
