import { beforeEach, describe, expect, it, vi } from "vitest"

const idb = vi.hoisted(() => ({
  values: new Map<IDBValidKey, unknown>(),
  deleteFailures: new Set<IDBValidKey>(),
}))

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: IDBValidKey) => idb.values.get(key)),
  set: vi.fn(async (key: IDBValidKey, value: unknown) => {
    idb.values.set(key, value)
  }),
  del: vi.fn(async (key: IDBValidKey) => {
    if (idb.deleteFailures.has(key)) throw new Error(`delete failed: ${String(key)}`)
    idb.values.delete(key)
  }),
  keys: vi.fn(async () => [...idb.values.keys()]),
}))

import {
  clearAllDrafts,
  deleteDraft,
  listDrafts,
  loadDraft,
  persistDraftPathInvalidation,
  saveDraft,
} from "@/lib/draft-storage"
import { tryRestoreDraft } from "@/lib/use-draft-sync"

const workspaceId = "workspace-a"

beforeEach(() => {
  vi.restoreAllMocks()
  idb.values.clear()
  idb.deleteFailures.clear()
  vi.spyOn(Date, "now").mockReturnValue(100)
})

describe("IndexedDB 草稿路径失效边界", () => {
  it("文件旧草稿即使物理删除失败也不会被 tryRestoreDraft 恢复，重建后的新草稿可恢复", async () => {
    const oldDraft = await saveDraft(workspaceId, "skills/fire.yml", {
      content: "old-local",
      baseContent: "old-server",
      baseRevision: "rev-old",
      draftVersion: 1,
    })
    await persistDraftPathInvalidation(workspaceId, "skills/fire.yml", false, oldDraft.savedAt)
    idb.deleteFailures.add("draft:v2:workspace-a:skills/fire.yml")
    await expect(deleteDraft(workspaceId, "skills/fire.yml")).rejects.toThrow("delete failed")

    await expect(tryRestoreDraft(workspaceId, "skills/fire.yml", "new-server", "rev-new")).resolves.toEqual({
      content: "new-server",
      serverContent: "new-server",
      baseRevision: "rev-new",
      draftVersion: 0,
      hasDraft: false,
    })
    await expect(listDrafts(workspaceId)).resolves.toEqual([])

    idb.deleteFailures.clear()
    const recreated = await saveDraft(workspaceId, "skills/fire.yml", {
      content: "new-local",
      baseContent: "recreated-server",
      baseRevision: "rev-recreated",
      draftVersion: 1,
    })
    expect(recreated.savedAt).toBeGreaterThan(oldDraft.savedAt)
    await expect(tryRestoreDraft(workspaceId, "skills/fire.yml", "recreated-server", "rev-recreated")).resolves.toMatchObject({
      content: "new-local",
      serverContent: "recreated-server",
      hasDraft: true,
    })
  })

  it("目录 cutoff 覆盖全部子路径，但不影响同前缀兄弟路径", async () => {
    const direct = await saveDraft(workspaceId, "skills/fire.yml", { content: "fire" })
    await saveDraft(workspaceId, "skills/nested/ice.yml", { content: "ice" })
    await saveDraft(workspaceId, "skills-extra/keep.yml", { content: "keep" })

    await persistDraftPathInvalidation(workspaceId, "skills", true, direct.savedAt)

    await expect(loadDraft(workspaceId, "skills/fire.yml")).resolves.toBeNull()
    await expect(loadDraft(workspaceId, "skills/nested/ice.yml")).resolves.toBeNull()
    await expect(loadDraft(workspaceId, "skills-extra/keep.yml")).resolves.toMatchObject({ content: "keep" })
    await expect(listDrafts(workspaceId)).resolves.toEqual(["skills-extra/keep.yml"])
  })

  it("clearAllDrafts 在物理草稿删除失败时保留 tombstone，不能重新激活垃圾键", async () => {
    const draft = await saveDraft(workspaceId, "skills/fire.yml", { content: "stale" })
    await persistDraftPathInvalidation(workspaceId, "skills/fire.yml", false, draft.savedAt)
    const draftKey = "draft:v2:workspace-a:skills/fire.yml"
    idb.deleteFailures.add(draftKey)

    await expect(clearAllDrafts(workspaceId)).rejects.toThrow("delete failed")

    expect([...idb.values.keys()].some((key) => String(key).startsWith("draft-invalidation:v1:workspace-a:"))).toBe(true)
    await expect(loadDraft(workspaceId, "skills/fire.yml")).resolves.toBeNull()

    idb.deleteFailures.clear()
    await clearAllDrafts(workspaceId)
    expect(idb.values.size).toBe(0)
  })
})
