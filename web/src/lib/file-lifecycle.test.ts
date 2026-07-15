import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetAcknowledgedRevisionChainsForTests } from "@/lib/acknowledged-revision-chain"
import { resetEditorInputFlushRegistryForTests, registerEditorInputFlush } from "@/lib/editor-input-flush"
import { resetFileOperationGuardsForTests } from "@/lib/file-operation-guard"

const mocks = vi.hoisted(() => ({
  clock: 10,
  drafts: new Map<string, {
    content: string
    savedAt: number
    baseContent?: string
    baseRevision?: number | string
    draftVersion?: number
    requiresConflictResolution?: boolean
  }>(),
  invalidations: [] as Array<{ path: string; isDirectory: boolean; cutoff: number }>,
  deleteFailures: new Set<string>(),
  saveFailures: new Set<string>(),
  fileDelete: vi.fn(),
  fileRename: vi.fn(),
  fileRead: vi.fn(),
  persistDraftSnapshots: vi.fn(),
  waitForFileSaveQueues: vi.fn(() => Promise.resolve()),
  listStoredDrafts: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  persistDraftPathInvalidation: vi.fn(),
}))

vi.mock("@/lib/file-save", () => ({
  waitForFileSaveQueues: mocks.waitForFileSaveQueues,
}))
vi.mock("@/lib/ws-client", () => ({
  wsClient: {
    fileDelete: mocks.fileDelete,
    fileRename: mocks.fileRename,
    fileRead: mocks.fileRead,
  },
}))
vi.mock("@/lib/draft-consistency", () => ({
  persistDraftSnapshots: mocks.persistDraftSnapshots,
  waitForDraftMutationsMatching: vi.fn(() => Promise.resolve()),
}))
vi.mock("@/lib/draft-storage", () => ({
  listStoredDrafts: mocks.listStoredDrafts,
  loadDraft: mocks.loadDraft,
  saveDraft: mocks.saveDraft,
  deleteDraft: mocks.deleteDraft,
  persistDraftPathInvalidation: mocks.persistDraftPathInvalidation,
}))

import { deleteServerPathSafely, renameServerPathSafely } from "@/lib/file-lifecycle"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

type MockDraft = {
  content: string
  savedAt: number
  baseContent?: string
  baseRevision?: number | string
  draftVersion?: number
  requiresConflictResolution?: boolean
}

function cutoffFor(path: string): number {
  return mocks.invalidations.reduce(
    (cutoff, invalidation) => path === invalidation.path || (invalidation.isDirectory && path.startsWith(`${invalidation.path}/`))
      ? Math.max(cutoff, invalidation.cutoff)
      : cutoff,
    0,
  )
}

function putDraft(path: string, draft: Omit<MockDraft, "savedAt">, savedAt = ++mocks.clock): MockDraft {
  const stored = { ...draft, savedAt }
  mocks.drafts.set(path, stored)
  return stored
}

function activeDraft(path: string): MockDraft | null {
  const draft = mocks.drafts.get(path)
  return draft && draft.savedAt > cutoffFor(path) ? draft : null
}

function file(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    workspaceId: "workspace-a",
    path,
    name: path.split("/").pop() ?? path,
    content: `${path}:server`,
    configType: "unknown",
    revision: 7,
    dirty: false,
    draftVersion: 0,
    ...overrides,
  }
}

function resetStore(openFiles: OpenFile[]) {
  useEditorStore.setState({
    workspaceId: "workspace-a",
    openFiles,
    activeFilePath: openFiles[0]?.path ?? null,
    recentlyClosed: [],
    fileContents: new Map(openFiles.map((item) => [item.path, item.content])),
    saveConflict: null,
    lifecycleError: null,
  })
}

function installDraftPersistence() {
  mocks.persistDraftSnapshots.mockImplementation(async (_workspaceId: string, files: OpenFile[]) => {
    for (const item of files) {
      if (item.dirty && item.draft != null) {
        putDraft(item.path, {
          content: item.draft,
          baseContent: item.content,
          baseRevision: item.revision,
          draftVersion: item.draftVersion,
          requiresConflictResolution: item.externalRevision != null,
        })
      }
    }
  })
}

function installDraftStorage() {
  mocks.listStoredDrafts.mockImplementation(async () => [...mocks.drafts.entries()]
    .filter(([path, draft]) => draft.savedAt > cutoffFor(path))
    .map(([path, draft]) => ({ path, draft: { ...draft, workspaceId: "workspace-a" } })))
  mocks.loadDraft.mockImplementation(async (_workspaceId: string, path: string) => {
    const draft = activeDraft(path)
    return draft ? { ...draft, workspaceId: "workspace-a" } : null
  })
  mocks.saveDraft.mockImplementation(async (_workspaceId: string, path: string, draft: Omit<MockDraft, "savedAt">) => {
    if (mocks.saveFailures.has(path)) throw new Error(`save failed: ${path}`)
    const previous = mocks.drafts.get(path)
    const stored = putDraft(path, draft, Math.max(++mocks.clock, cutoffFor(path) + 1, (previous?.savedAt ?? 0) + 1))
    return { ...stored, workspaceId: "workspace-a" }
  })
  mocks.deleteDraft.mockImplementation(async (_workspaceId: string, path: string) => {
    if (mocks.deleteFailures.has(path)) throw new Error(`delete failed: ${path}`)
    mocks.drafts.delete(path)
  })
  mocks.persistDraftPathInvalidation.mockImplementation(async (
    _workspaceId: string,
    path: string,
    isDirectory: boolean,
    minimumCutoff = 0,
  ) => {
    const existing = mocks.invalidations.find(
      (invalidation) => invalidation.path === path && invalidation.isDirectory === isDirectory,
    )
    const cutoff = Math.max(++mocks.clock, minimumCutoff, existing?.cutoff ?? 0)
    if (existing) existing.cutoff = cutoff
    else mocks.invalidations.push({ path, isDirectory, cutoff })
    return { workspaceId: "workspace-a", path, isDirectory, cutoff }
  })
}

describe("Sidebar 破坏性文件生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clock = 10
    mocks.drafts.clear()
    mocks.invalidations.splice(0)
    mocks.deleteFailures.clear()
    mocks.saveFailures.clear()
    resetAcknowledgedRevisionChainsForTests()
    resetEditorInputFlushRegistryForTests()
    resetFileOperationGuardsForTests()
    installDraftPersistence()
    installDraftStorage()
    mocks.fileDelete.mockResolvedValue({ success: true })
    mocks.fileRename.mockResolvedValue({ success: true })
    mocks.fileRead.mockImplementation(async (path: string) => ({ path, content: `${path}:server`, revision: "v2-new" }))
  })

  it("文件删除会先 flush、持久化并等待保存队列，再远端删除", async () => {
    resetStore([file("skills/fire.yml", { draft: "buffer-before-flush", dirty: true, draftVersion: 1 })])
    let flushed = false
    registerEditorInputFlush(() => {
      if (!flushed) {
        flushed = true
        useEditorStore.getState().updateDraft("skills/fire.yml", "flushed-flow-content")
      }
      return true
    })
    mocks.fileDelete.mockImplementation(async () => {
      expect(mocks.waitForFileSaveQueues).toHaveBeenCalled()
      expect(mocks.drafts.get("skills/fire.yml")?.content).toBe("flushed-flow-content")
      expect(activeDraft("skills/fire.yml")).toBeNull()
      expect(mocks.persistDraftPathInvalidation).toHaveBeenCalledWith(
        "workspace-a",
        "skills/fire.yml",
        false,
        expect.any(Number),
      )
      expect(useEditorStore.getState().openFiles).toEqual([])
      return { success: true }
    })

    const result = await deleteServerPathSafely("skills/fire.yml", false)

    expect(result).toMatchObject({ success: true, changed: true })
    expect(mocks.fileDelete).toHaveBeenCalledWith("skills/fire.yml")
    expect(mocks.drafts.has("skills/fire.yml")).toBe(false)
  })

  it("目录删除覆盖全部子路径的标签、recentlyClosed、缓存和草稿", async () => {
    const child = file("skills/fire.yml", { draft: "dirty", dirty: true, draftVersion: 1 })
    const nested = file("skills/nested/ice.yml")
    const unrelated = file("jobs/mage.yml")
    resetStore([child, nested, unrelated])
    useEditorStore.setState({
      recentlyClosed: [file("skills/closed.yml", { draft: "closed-draft", dirty: true })],
      fileContents: new Map([
        [child.path, child.content],
        [nested.path, nested.content],
        ["skills/cached.yml", "cached"],
        [unrelated.path, unrelated.content],
      ]),
    })
    putDraft("skills/closed.yml", { content: "closed-draft" })
    putDraft("skills/nested/ice.yml", { content: "nested-draft" })
    putDraft("jobs/mage.yml", { content: "unrelated" })

    await expect(deleteServerPathSafely("skills", true)).resolves.toMatchObject({ success: true })

    const state = useEditorStore.getState()
    expect(state.openFiles.map((item) => item.path)).toEqual(["jobs/mage.yml"])
    expect(state.recentlyClosed).toEqual([])
    expect([...state.fileContents.keys()]).toEqual(["jobs/mage.yml"])
    expect([...mocks.drafts.keys()]).toEqual(["jobs/mage.yml"])
  })

  it("草稿确认失败时不调用远端删除并保留标签", async () => {
    resetStore([file("skills/fire.yml", { draft: "must-survive", dirty: true })])
    mocks.persistDraftSnapshots.mockRejectedValueOnce(new Error("indexeddb unavailable"))

    const result = await deleteServerPathSafely("skills/fire.yml", false)

    expect(result).toMatchObject({ success: false, changed: false })
    expect(mocks.fileDelete).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ path: "skills/fire.yml", draft: "must-survive" })
  })

  it("远端目录删除失败会恢复全部已捕获草稿并以新 savedAt 重激活", async () => {
    const dirty = file("skills/fire.yml", { draft: "local-draft", dirty: true, draftVersion: 1 })
    resetStore([dirty])
    const currentBefore = putDraft(dirty.path, { content: "local-draft" })
    const backgroundBefore = putDraft("skills/not-open.yml", { content: "background-draft" })
    mocks.fileDelete.mockRejectedValueOnce(new Error("relay rejected delete"))

    const result = await deleteServerPathSafely("skills", true)

    expect(result).toMatchObject({ success: false, changed: false })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      path: dirty.path,
      draft: "local-draft",
      dirty: true,
    })
    expect(useEditorStore.getState().activeFilePath).toBe(dirty.path)
    expect(activeDraft(dirty.path)).toMatchObject({ content: "local-draft" })
    expect(activeDraft("skills/not-open.yml")).toMatchObject({ content: "background-draft" })
    expect(mocks.drafts.get(dirty.path)?.savedAt).toBeGreaterThan(currentBefore.savedAt)
    expect(mocks.drafts.get("skills/not-open.yml")?.savedAt).toBeGreaterThan(backgroundBefore.savedAt)
  })

  it("目录重命名迁移标签、草稿键、recentlyClosed、缓存和活动路径并刷新 revision", async () => {
    const dirty = file("skills/fire.yml", {
      content: "skills/fire.yml:server",
      draft: "local-draft",
      dirty: true,
      draftVersion: 2,
    })
    const clean = file("skills/nested/ice.yml")
    resetStore([dirty, clean])
    useEditorStore.setState({
      activeFilePath: clean.path,
      recentlyClosed: [file("skills/closed.yml")],
      fileContents: new Map([
        [dirty.path, dirty.content],
        [clean.path, clean.content],
        ["skills/cached.yml", "cached"],
      ]),
    })
    putDraft(dirty.path, {
      content: "local-draft",
      baseContent: dirty.content,
      baseRevision: 7,
      draftVersion: 2,
    })
    mocks.fileRead.mockImplementation(async (path: string) => ({
      path,
      content: path === "abilities/fire.yml" ? dirty.content : path.replace("abilities", "skills") + ":server",
      revision: "v2-renamed",
    }))

    const result = await renameServerPathSafely("skills", "abilities", true)

    expect(result).toMatchObject({ success: true, changed: true })
    expect(mocks.fileRename).toHaveBeenCalledWith("skills", "abilities")
    const state = useEditorStore.getState()
    expect(state.openFiles.map((item) => item.path)).toEqual([
      "abilities/fire.yml",
      "abilities/nested/ice.yml",
    ])
    expect(state.openFiles[0]).toMatchObject({
      revision: "v2-renamed",
      draft: "local-draft",
      dirty: true,
      externalRevision: undefined,
    })
    expect(state.recentlyClosed[0].path).toBe("abilities/closed.yml")
    expect(state.activeFilePath).toBe("abilities/nested/ice.yml")
    expect([...state.fileContents.keys()]).toEqual([
      "abilities/fire.yml",
      "abilities/nested/ice.yml",
      "abilities/cached.yml",
    ])
    expect(mocks.drafts.has("skills/fire.yml")).toBe(false)
    expect(mocks.drafts.get("abilities/fire.yml")?.content).toBe("local-draft")
  })

  it("远端目录重命名失败会回滚新路径并重激活非当前标签草稿", async () => {
    const dirty = file("skills/fire.yml", { draft: "local-draft", dirty: true, draftVersion: 1 })
    resetStore([dirty])
    const backgroundBefore = putDraft("skills/not-open.yml", { content: "background-draft" })
    mocks.fileRename.mockRejectedValueOnce(new Error("relay rejected rename"))

    const result = await renameServerPathSafely("skills", "abilities", true)

    expect(result).toMatchObject({ success: false, changed: false })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      path: "skills/fire.yml",
      draft: "local-draft",
    })
    expect(useEditorStore.getState().activeFilePath).toBe("skills/fire.yml")
    expect(activeDraft("skills/fire.yml")).toMatchObject({ content: "local-draft" })
    expect(activeDraft("skills/not-open.yml")).toMatchObject({ content: "background-draft" })
    expect(mocks.drafts.get("skills/not-open.yml")?.savedAt).toBeGreaterThan(backgroundBefore.savedAt)
    expect(activeDraft("abilities/fire.yml")).toBeNull()
    expect(activeDraft("abilities/not-open.yml")).toBeNull()
  })

  it("文件删除成功后即使物理 del 失败，旧键也只作为失效垃圾保留", async () => {
    resetStore([])
    putDraft("skills/fire.yml", { content: "stale-file-draft" })
    mocks.deleteFailures.add("skills/fire.yml")

    const result = await deleteServerPathSafely("skills/fire.yml", false)

    expect(result).toMatchObject({ success: true, changed: true })
    expect(result.message).toContain("cutoff")
    expect(mocks.drafts.has("skills/fire.yml")).toBe(true)
    expect(activeDraft("skills/fire.yml")).toBeNull()
    await expect(mocks.listStoredDrafts("workspace-a")).resolves.toEqual([])
  })

  it("目录删除的 cutoff 覆盖所有子路径物理残留", async () => {
    resetStore([])
    putDraft("skills/fire.yml", { content: "fire" })
    putDraft("skills/nested/ice.yml", { content: "ice" })
    mocks.deleteFailures.add("skills/fire.yml")
    mocks.deleteFailures.add("skills/nested/ice.yml")

    await expect(deleteServerPathSafely("skills", true)).resolves.toMatchObject({ success: true, changed: true })

    expect(activeDraft("skills/fire.yml")).toBeNull()
    expect(activeDraft("skills/nested/ice.yml")).toBeNull()
    expect(mocks.drafts.has("skills/fire.yml")).toBe(true)
    expect(mocks.drafts.has("skills/nested/ice.yml")).toBe(true)
  })

  it("文件重命名成功后新路径草稿可恢复，旧路径 del 失败不会重新出现", async () => {
    const dirty = file("skills/fire.yml", { draft: "local-draft", dirty: true, draftVersion: 1 })
    resetStore([dirty])
    mocks.deleteFailures.add("skills/fire.yml")

    const result = await renameServerPathSafely("skills/fire.yml", "skills/flame.yml", false)

    expect(result).toMatchObject({ success: true, changed: true })
    expect(mocks.drafts.has("skills/fire.yml")).toBe(true)
    expect(activeDraft("skills/fire.yml")).toBeNull()
    expect(activeDraft("skills/flame.yml")).toMatchObject({ content: "local-draft" })
    await expect(mocks.listStoredDrafts("workspace-a")).resolves.toEqual([
      expect.objectContaining({ path: "skills/flame.yml" }),
    ])
  })

  it("后续 rename 不会把已失效旧键迁移到重建路径的新名称", async () => {
    resetStore([])
    putDraft("skills/fire.yml", { content: "stale-before-delete" })
    mocks.deleteFailures.add("skills/fire.yml")
    await deleteServerPathSafely("skills/fire.yml", false)
    mocks.deleteFailures.clear()

    const result = await renameServerPathSafely("skills/fire.yml", "skills/flame.yml", false)

    expect(result).toMatchObject({ success: true, changed: true })
    expect(activeDraft("skills/fire.yml")).toBeNull()
    expect(activeDraft("skills/flame.yml")).toBeNull()
    expect(mocks.drafts.has("skills/flame.yml")).toBe(false)
  })

  it("远端失败后 IndexedDB 恢复失败会保留标签并明确标记草稿不安全", async () => {
    const dirty = file("skills/fire.yml", { draft: "local-draft", dirty: true, draftVersion: 1 })
    resetStore([dirty])
    putDraft("skills/not-open.yml", { content: "background-draft" })
    mocks.saveFailures.add("skills/not-open.yml")
    mocks.fileDelete.mockRejectedValueOnce(new Error("relay rejected delete"))

    const result = await deleteServerPathSafely("skills", true)

    expect(result).toMatchObject({ success: false, changed: false })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ path: dirty.path, draft: "local-draft" })
    expect(result.message).toContain("不能认为数据安全")
    expect(useEditorStore.getState().lifecycleError).toBe(result.message)
    expect(activeDraft("skills/not-open.yml")).toBeNull()
  })
})
