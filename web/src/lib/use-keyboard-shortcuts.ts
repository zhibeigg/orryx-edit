import { useEffect } from "react"
import { useEditorStore } from "@/store/editor-store"
import { wsClient } from "@/lib/ws-client"
import { deleteDraft } from "@/lib/draft-storage"

/**
 * 全局快捷键 Hook
 * - Ctrl+S / Cmd+S：保存当前文件到服务器
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        const { openFiles, activeFilePath, markSaved } = useEditorStore.getState()
        const activeFile = openFiles.find((f) => f.path === activeFilePath)
        if (!activeFile?.dirty || activeFile.draft == null) return

        try {
          const res = await wsClient.fileWrite(activeFile.path, activeFile.draft)
          if (res.success) {
            markSaved(activeFile.path, activeFile.draft)
            await deleteDraft(activeFile.path)
          }
        } catch (err) {
          console.error("保存失败:", err)
        }
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
}
