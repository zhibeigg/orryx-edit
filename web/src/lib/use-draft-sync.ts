import { useEffect, useRef } from "react"
import { useEditorStore } from "@/store/editor-store"
import { saveDraft, loadDraft, deleteDraft } from "@/lib/draft-storage"

/**
 * 草稿自动保存 Hook
 * - 编辑器内容变更后 1 秒自动保存到 IndexedDB
 * - 组件卸载时立即保存所有 dirty 文件
 */
export function useDraftSync() {
  const openFiles = useEditorStore((s) => s.openFiles)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filesRef = useRef(openFiles)
  useEffect(() => {
    filesRef.current = openFiles
  }, [openFiles])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      for (const file of openFiles) {
        if (file.dirty && file.draft != null) {
          saveDraft(file.path, file.draft)
        } else if (!file.dirty) {
          deleteDraft(file.path)
        }
      }
    }, 1000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [openFiles])

  // 页面卸载时立即保存所有 dirty 文件
  useEffect(() => {
    const handleBeforeUnload = () => {
      for (const file of filesRef.current) {
        if (file.dirty && file.draft != null) {
          saveDraft(file.path, file.draft)
        }
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      // 组件卸载时也执行一次保存
      handleBeforeUnload()
    }
  }, [])
}

/**
 * 尝试恢复草稿内容
 * 在打开文件时调用，如果有草稿则返回草稿内容
 */
export async function tryRestoreDraft(path: string, serverContent: string): Promise<{ content: string; hasDraft: boolean }> {
  const draft = await loadDraft(path)
  if (draft && draft.content !== serverContent) {
    return { content: draft.content, hasDraft: true }
  }
  return { content: serverContent, hasDraft: false }
}
