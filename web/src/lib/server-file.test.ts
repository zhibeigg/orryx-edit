import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  acknowledgeSavedRevision,
  resetAcknowledgedRevisionChainsForTests,
  resolveAcknowledgedSaveRevision,
} from "@/lib/acknowledged-revision-chain"
import { resetEditorInputFlushRegistryForTests } from "@/lib/editor-input-flush"
import { acquireFileOperationLock, resetFileOperationGuardsForTests } from "@/lib/file-operation-guard"
import { fileSaveQueueKey } from "@/lib/file-save-snapshot"

const mocks = vi.hoisted(() => ({
  fileRead: vi.fn(),
  persistDraftSnapshot: vi.fn(() => Promise.resolve()),
  deleteDraftSnapshotIfUnchanged: vi.fn(() => Promise.resolve(true)),
  tryRestoreDraft: vi.fn(),
}))

vi.mock("@/lib/ws-client", () => ({ wsClient: { fileRead: mocks.fileRead } }))
vi.mock("@/lib/draft-consistency", () => ({
  persistDraftSnapshot: mocks.persistDraftSnapshot,
  persistDraftSnapshots: vi.fn(() => Promise.resolve()),
  deleteDraftSnapshotIfUnchanged: mocks.deleteDraftSnapshotIfUnchanged,
}))
vi.mock("@/lib/use-draft-sync", () => ({
  tryRestoreDraft: mocks.tryRestoreDraft,
}))

import { openServerFile, reloadEditorFileFromServer, resynchronizeOpenFiles } from "@/lib/server-file"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

const file: OpenFile = {
  workspaceId: "workspace-a",
  path: "skills/fire.yml",
  name: "fire.yml",
  content: "server-old",
  configType: "skill",
  revision: "rev-a",
  draft: "local-one",
  dirty: true,
  draftVersion: 1,
}

describe("服务器 reload revision 隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAcknowledgedRevisionChainsForTests()
    resetEditorInputFlushRegistryForTests()
    resetFileOperationGuardsForTests()
    mocks.tryRestoreDraft.mockImplementation(async (_workspaceId: string, _path: string, content: string, revision: number | string) => ({
      content,
      serverContent: content,
      baseRevision: revision,
      draftVersion: 0,
      hasDraft: false,
    }))
    useEditorStore.setState({
      workspaceId: "workspace-a",
      openFiles: [file],
      activeFilePath: file.path,
      recentlyClosed: [],
      fileContents: new Map(),
      saveConflict: null,
      lifecycleError: null,
    })
  })

  it("打开文件读取期间发生破坏性操作时，不挂载操作前读取到的旧草稿", async () => {
    const path = "skills/ice.yml"
    let resolveRead: ((value: { path: string; content: string; revision: string }) => void) | undefined
    mocks.fileRead.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRead = resolve
    }))
    mocks.tryRestoreDraft.mockResolvedValueOnce({
      content: "stale-local-draft",
      serverContent: "stale-server",
      baseRevision: "rev-stale",
      draftVersion: 1,
      hasDraft: true,
    })

    const opening = openServerFile(path)
    const release = acquireFileOperationLock("workspace-a", (candidate) => candidate === path)
    release()
    resolveRead?.({ path, content: "stale-server", revision: "rev-stale" })
    await opening

    expect(useEditorStore.getState().openFiles.some((candidate) => candidate.path === path)).toBe(false)
  })

  it("reload 读取期间的新输入保留旧 base，并把服务器 revision 标为外部冲突", async () => {
    let resolveRead: ((value: { path: string; content: string; revision: string }) => void) | undefined
    mocks.fileRead.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRead = resolve
    }))
    const key = fileSaveQueueKey("workspace-a", file.path)
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-local")

    const reload = reloadEditorFileFromServer(file.path, 1, "local-one")
    useEditorStore.getState().updateDraft(file.path, "local-two")
    resolveRead?.({ path: file.path, content: "server-external", revision: "rev-external" })
    await reload

    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "server-old",
      revision: "rev-a",
      draft: "local-two",
      dirty: true,
      externalRevision: "rev-external",
    })
    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-a")
    expect(mocks.persistDraftSnapshot).toHaveBeenCalledWith(
      "workspace-a",
      expect.objectContaining({ draft: "local-two", revision: "rev-a" }),
    )
  })

  it("同 workspace 重连会刷新 clean 文件，并保留 dirty 草稿为显式冲突", async () => {
    const clean = { ...file, path: "skills/clean.yml", name: "clean.yml", content: "clean-old", revision: 4, draft: undefined, dirty: false, draftVersion: 0 }
    const dirty = { ...file, path: "skills/dirty.yml", name: "dirty.yml", content: "dirty-old", revision: 9, draft: "local-draft", dirty: true, draftVersion: 3 }
    useEditorStore.setState({
      openFiles: [clean, dirty],
      activeFilePath: dirty.path,
    })
    mocks.fileRead.mockImplementation(async (path: string) => path === clean.path
      ? { path, content: "clean-new", revision: "v2-clean" }
      : { path, content: "dirty-server-new", revision: "v2-dirty" })
    const cleanKey = fileSaveQueueKey("workspace-a", clean.path)
    const dirtyKey = fileSaveQueueKey("workspace-a", dirty.path)
    acknowledgeSavedRevision(cleanKey, 4, 4, 5)
    acknowledgeSavedRevision(dirtyKey, 9, 9, 10)

    await expect(resynchronizeOpenFiles("workspace-a")).resolves.toBe(true)

    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({
        path: clean.path,
        content: "clean-new",
        revision: "v2-clean",
        dirty: false,
        externalRevision: undefined,
      }),
      expect.objectContaining({
        path: dirty.path,
        content: "dirty-server-new",
        revision: "v2-dirty",
        draft: "local-draft",
        dirty: true,
        externalRevision: "v2-dirty",
      }),
    ])
    expect(resolveAcknowledgedSaveRevision(cleanKey, 4)).toBe(4)
    expect(resolveAcknowledgedSaveRevision(dirtyKey, 9)).toBe(9)
    expect(mocks.persistDraftSnapshot).toHaveBeenCalledWith(
      "workspace-a",
      expect.objectContaining({ path: dirty.path, revision: "v2-dirty", externalRevision: "v2-dirty" }),
    )
  })

  it("快速连续的权威切换会串行执行两次刷新而不合并后一次 revision 域", async () => {
    let resolveFirstRead: ((value: { path: string; content: string; revision: string }) => void) | undefined
    mocks.fileRead
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstRead = resolve
      }))
      .mockResolvedValueOnce({ path: file.path, content: "server-v1", revision: 0 })

    const first = resynchronizeOpenFiles("workspace-a")
    const second = resynchronizeOpenFiles("workspace-a")
    await vi.waitFor(() => expect(mocks.fileRead).toHaveBeenCalledTimes(1))
    resolveFirstRead?.({ path: file.path, content: "server-v2", revision: "v2-new" })

    await first
    await second

    expect(mocks.fileRead).toHaveBeenCalledTimes(2)
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "server-v1",
      revision: 0,
      draft: "local-one",
      dirty: true,
      externalRevision: 0,
    })
  })

  it.each([
    { oldRevision: "v2-old", nextRevision: 0 },
    { oldRevision: 12, nextRevision: "v2-new" },
  ])("协议 revision 类型从 $oldRevision 切到 $nextRevision 时使用新域并锁定 dirty 保存", async ({ oldRevision, nextRevision }) => {
    const dirty = { ...file, revision: oldRevision, draft: "local-draft", dirty: true }
    useEditorStore.setState({ openFiles: [dirty], activeFilePath: dirty.path })
    mocks.fileRead.mockResolvedValue({ path: dirty.path, content: "server-after-restart", revision: nextRevision })

    await resynchronizeOpenFiles("workspace-a")

    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      revision: nextRevision,
      externalRevision: nextRevision,
      draft: "local-draft",
      dirty: true,
    })
  })
})
