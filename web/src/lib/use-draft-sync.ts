import { useEffect, useRef } from "react"
import {
  deleteDraftSnapshotIfUnchanged,
  persistDraftSnapshot,
  persistDraftSnapshotsBestEffort,
} from "@/lib/draft-consistency"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import { loadDraft, type StoredDraft } from "@/lib/draft-storage"
import { useEditorStore } from "@/store/editor-store"
import type { RevisionToken } from "@/types/protocol"

/**
 * 草稿自动保存 Hook
 * - 编辑器内容变更后 1 秒自动保存到 IndexedDB
 * - 文件关闭由 editor store 立即补存，避免 debounce 窗口丢失
 * - 组件卸载始终使用挂载时的 workspaceId，不回退到 unbound
 */
export function useDraftSync(workspaceId: string) {
  const openFiles = useEditorStore((state) => state.openFiles)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDraftsRef = useRef(new Map<string, string>())

  useEffect(() => {
    const workspaceFiles = openFiles.filter((file) => file.workspaceId === workspaceId)
    for (const file of workspaceFiles) {
      if (file.dirty && file.draft != null) {
        lastDraftsRef.current.set(file.path, file.draft)
      }
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      for (const capturedFile of workspaceFiles) {
        // 生命周期操作可能已关闭或迁移标签；过期 debounce 绝不能在远端 rename/delete 后重建旧草稿键。
        const file = useEditorStore.getState().openFiles.find(
          (candidate) => candidate.workspaceId === workspaceId && candidate.path === capturedFile.path,
        )
        if (!file) continue
        if (file.dirty && file.draft != null) {
          lastDraftsRef.current.set(file.path, file.draft)
          void persistDraftSnapshot(workspaceId, file)
        } else {
          const lastDraft = lastDraftsRef.current.get(file.path)
          if (lastDraft != null) {
            lastDraftsRef.current.delete(file.path)
            void deleteDraftSnapshotIfUnchanged(workspaceId, file.path, lastDraft)
          }
        }
      }
    }, 1000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [openFiles, workspaceId])

  useEffect(() => {
    const persistCurrentDraftsBestEffort = () => {
      // beforeunload 无法等待 IndexedDB；先同步 flush 输入，再明确执行 best-effort，绝不视为已确认。
      flushEditorInputs()
      const currentFiles = useEditorStore.getState().openFiles.filter((file) => file.workspaceId === workspaceId)
      persistDraftSnapshotsBestEffort(workspaceId, currentFiles)
    }
    window.addEventListener("beforeunload", persistCurrentDraftsBestEffort)
    return () => {
      window.removeEventListener("beforeunload", persistCurrentDraftsBestEffort)
      persistCurrentDraftsBestEffort()
    }
  }, [workspaceId])
}

export interface RestoredDraft {
  content: string
  serverContent: string
  baseRevision: RevisionToken
  draftVersion: number
  externalRevision?: RevisionToken
  hasDraft: boolean
}

export function restoreDraftAgainstServer(
  draft: StoredDraft | null,
  serverContent: string,
  serverRevision: RevisionToken,
): RestoredDraft {
  if (draft && draft.content !== serverContent) {
    const baseRevision = draft.baseRevision ?? serverRevision
    return {
      content: draft.content,
      serverContent: draft.baseContent ?? serverContent,
      baseRevision,
      draftVersion: draft.draftVersion ?? 1,
      ...(draft.requiresConflictResolution || baseRevision !== serverRevision
        ? { externalRevision: serverRevision }
        : {}),
      hasDraft: true,
    }
  }
  return {
    content: serverContent,
    serverContent,
    baseRevision: serverRevision,
    draftVersion: 0,
    hasDraft: false,
  }
}

/** 尝试恢复同一 workspace 的草稿，并保留草稿实际基于的 base revision。 */
export async function tryRestoreDraft(
  workspaceId: string,
  path: string,
  serverContent: string,
  serverRevision: RevisionToken,
): Promise<RestoredDraft> {
  const loadedDraft = await loadDraft(workspaceId, path)
  // 再次回读以关闭“首次读取后、恢复前刚好写入 tombstone”的窗口。
  const verifiedDraft = loadedDraft ? await loadDraft(workspaceId, path) : null
  const draft = loadedDraft && verifiedDraft?.savedAt === loadedDraft.savedAt ? loadedDraft : null
  const restored = restoreDraftAgainstServer(draft, serverContent, serverRevision)
  if (draft && !restored.hasDraft) {
    await deleteDraftSnapshotIfUnchanged(workspaceId, path, draft.content)
  }
  return restored
}
