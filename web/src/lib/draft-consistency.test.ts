import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(() => Promise.resolve()),
  loadDraft: vi.fn(() => Promise.resolve(null)),
  deleteDraft: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/draft-storage", () => ({
  saveDraft: mocks.saveDraft,
  loadDraft: mocks.loadDraft,
  deleteDraft: mocks.deleteDraft,
}))

import {
  canDeleteDraftSnapshot,
  persistDraftSnapshot,
  persistDraftSnapshotsBestEffort,
} from "@/lib/draft-consistency"
import { acquireFileOperationLock, resetFileOperationGuardsForTests } from "@/lib/file-operation-guard"

const dirtyFile = {
  path: "skills/fire.yml",
  content: "server",
  revision: 1,
  draft: "local",
  dirty: true,
  draftVersion: 1,
}

describe("IndexedDB 草稿删除校验", () => {
  const draft = { content: "draft", savedAt: 1 }

  beforeEach(() => {
    vi.clearAllMocks()
    resetFileOperationGuardsForTests()
  })

  it("代次与内容都匹配时才允许删除", () => {
    expect(canDeleteDraftSnapshot(draft, "draft", 3, 3)).toBe(true)
    expect(canDeleteDraftSnapshot(draft, "newer", 3, 3)).toBe(false)
    expect(canDeleteDraftSnapshot(draft, "draft", 3, 4)).toBe(false)
    expect(canDeleteDraftSnapshot(null, "draft", 3, 3)).toBe(false)
  })

  it("文件操作锁阻止 debounce 和 beforeunload best-effort 在旧路径重新写入", async () => {
    const release = acquireFileOperationLock("workspace-a", (path) => path === dirtyFile.path)

    await persistDraftSnapshot("workspace-a", dirtyFile)
    persistDraftSnapshotsBestEffort("workspace-a", [dirtyFile])
    await Promise.resolve()

    expect(mocks.saveDraft).not.toHaveBeenCalled()

    await persistDraftSnapshot("workspace-a", dirtyFile, { allowDuringFileOperation: true })
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
    release()
  })
})
