import { describe, expect, it } from "vitest"
import {
  applyAcknowledgedSnapshot,
  canCloseAfterSaving,
  draftVersionOf,
  hasExternalRevision,
  reconcileServerSnapshot,
  updateFileDraft,
  type EditorFileSnapshotState,
} from "@/lib/editor-file-state"

const baseFile: EditorFileSnapshotState & { path: string } = {
  path: "skills/fire.yml",
  content: "old",
  revision: "rev-a",
  dirty: false,
  draftVersion: 0,
}

describe("编辑器保存快照一致性", () => {
  it("响应只确认请求时的内容和草稿代次", () => {
    const requested = updateFileDraft(baseFile, "request")
    const acknowledged = applyAcknowledgedSnapshot(requested, "request", "rev-b", draftVersionOf(requested))

    expect(acknowledged).toMatchObject({
      content: "request",
      revision: "rev-b",
      dirty: false,
      draft: undefined,
    })
  })

  it("保存响应期间的新输入继续保留为 dirty 草稿", () => {
    const requested = updateFileDraft(baseFile, "request")
    const editedAgain = updateFileDraft(requested, "newer")
    const acknowledged = applyAcknowledgedSnapshot(editedAgain, "request", "rev-b", draftVersionOf(requested))

    expect(acknowledged).toMatchObject({
      content: "request",
      revision: "rev-b",
      draft: "newer",
      dirty: true,
      draftVersion: editedAgain.draftVersion,
    })
  })

  it("响应期间改回旧服务器内容也不会被请求快照覆盖", () => {
    const requested = updateFileDraft(baseFile, "request")
    const revertedWhileSaving = updateFileDraft(requested, "old")
    expect(revertedWhileSaving.draft).toBeUndefined()

    const acknowledged = applyAcknowledgedSnapshot(
      revertedWhileSaving,
      "request",
      "rev-b",
      draftVersionOf(requested),
    )

    expect(acknowledged).toMatchObject({
      content: "request",
      draft: "old",
      dirty: true,
    })
  })

  it("保存响应不会清除响应期间到达的外部 revision", () => {
    const requested = updateFileDraft({ ...baseFile, externalRevision: "rev-external" }, "request")
    const acknowledged = applyAcknowledgedSnapshot(requested, "request", "rev-local", draftVersionOf(requested))

    expect(acknowledged).toMatchObject({
      revision: "rev-local",
      externalRevision: "rev-external",
    })
  })

  it("重连快照刷新 clean 文件并把 dirty 草稿切到显式冲突状态", () => {
    expect(reconcileServerSnapshot(baseFile, "server-new", "v2-new", true)).toMatchObject({
      content: "server-new",
      revision: "v2-new",
      dirty: false,
      externalRevision: undefined,
    })

    const dirty = updateFileDraft(baseFile, "local-draft")
    expect(reconcileServerSnapshot(dirty, "server-new", "v2-new", true)).toMatchObject({
      content: "server-new",
      revision: "v2-new",
      draft: "local-draft",
      dirty: true,
      externalRevision: "v2-new",
    })
  })

  it("revision 作为不透明 token，仅比较是否相等", () => {
    expect(hasExternalRevision(10, 2)).toBe(true)
    expect(hasExternalRevision("rev-10", "rev-2")).toBe(true)
    expect(hasExternalRevision("same", "same")).toBe(false)
  })

  it("只有全部成功且最终没有 dirty 文件时才允许关闭", () => {
    expect(canCloseAfterSaving(true, [{ dirty: false }])).toBe(true)
    expect(canCloseAfterSaving(false, [{ dirty: false }])).toBe(false)
    expect(canCloseAfterSaving(true, [{ dirty: true }])).toBe(false)
  })
})
