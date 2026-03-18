import { useEffect } from "react"
import { useEditorStore } from "@/store/editor-store"
import { wsClient } from "@/lib/ws-client"
import { deleteDraft } from "@/lib/draft-storage"

/**
 * 全局快捷键 Hook
 * - Ctrl+S：保存当前文件
 * - Ctrl+K W：全部关闭
 * - Ctrl+K U：关闭已保存
 * - Ctrl+K S：全部保存并关闭
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    let waitingForK = false

    const handler = async (e: KeyboardEvent) => {
      // Ctrl+K 组合键前缀
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        waitingForK = true
        return
      }

      if (waitingForK) {
        waitingForK = false
        const key = e.key.toLowerCase()

        if (key === "w") {
          // Ctrl+K W：全部关闭
          e.preventDefault()
          useEditorStore.getState().closeAllFiles()
          return
        }

        if (key === "u") {
          // Ctrl+K U：关闭已保存
          e.preventDefault()
          useEditorStore.getState().closeSavedFiles()
          return
        }

        if (key === "s") {
          // Ctrl+K S：全部保存并关闭
          e.preventDefault()
          const store = useEditorStore.getState()
          for (const f of store.openFiles.filter(f => f.dirty)) {
            try {
              const content = f.draft ?? f.content
              await wsClient.fileWrite(f.path, content)
              store.markSaved(f.path, content)
              await deleteDraft(f.path)
            } catch { /* skip */ }
          }
          store.closeAllFiles()
          return
        }
      }

      // Ctrl+S：保存当前文件
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
