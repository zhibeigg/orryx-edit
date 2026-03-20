import { useEffect } from "react"
import { useEditorStore } from "@/store/editor-store"
import { wsClient } from "@/lib/ws-client"
import { deleteDraft } from "@/lib/draft-storage"

/**
 * 全局快捷键 Hook
 *
 * 单键：
 *   Ctrl+S          保存当前文件
 *   Ctrl+Shift+S    全部保存
 *   Ctrl+W          关闭当前标签页
 *   Ctrl+Shift+T    重新打开最近关闭的标签页
 *   Ctrl+Tab        切换到下一个标签页
 *   Ctrl+Shift+Tab  切换到上一个标签页
 *   Ctrl+1~9        切换到第 N 个标签页
 *
 * 组合键（Ctrl+K 前缀）：
 *   Ctrl+K W        全部关闭
 *   Ctrl+K U        关闭已保存
 *   Ctrl+K S        全部保存并关闭
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    let waitingForK = false

    const handler = async (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // ── Ctrl+K 组合键前缀 ──
      if (ctrl && e.key === "k") {
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
          await saveAllFiles()
          useEditorStore.getState().closeAllFiles()
          return
        }
      }

      // ── Ctrl+Shift+S：全部保存 ──
      if (ctrl && e.shiftKey && e.key === "S") {
        e.preventDefault()
        await saveAllFiles()
        return
      }

      // ── Ctrl+S：保存当前文件 ──
      if (ctrl && !e.shiftKey && e.key === "s") {
        e.preventDefault()
        await saveActiveFile()
        return
      }

      // ── Ctrl+W：关闭当前标签页 ──
      if (ctrl && e.key === "w") {
        e.preventDefault()
        const { activeFilePath, closeFile } = useEditorStore.getState()
        if (activeFilePath) closeFile(activeFilePath)
        return
      }

      // ── Ctrl+Shift+T：重新打开最近关闭的标签页 ──
      if (ctrl && e.shiftKey && e.key === "T") {
        e.preventDefault()
        useEditorStore.getState().reopenLastClosed()
        return
      }

      // ── Ctrl+Tab / Ctrl+Shift+Tab：切换标签页 ──
      if (ctrl && e.key === "Tab") {
        e.preventDefault()
        const { openFiles, activeFilePath, setActiveFile } = useEditorStore.getState()
        if (openFiles.length <= 1) return
        const idx = openFiles.findIndex((f) => f.path === activeFilePath)
        const next = e.shiftKey
          ? (idx - 1 + openFiles.length) % openFiles.length
          : (idx + 1) % openFiles.length
        setActiveFile(openFiles[next].path)
        return
      }

      // ── Ctrl+1~9：切换到第 N 个标签页 ──
      if (ctrl && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault()
        const { openFiles, setActiveFile } = useEditorStore.getState()
        const idx = parseInt(e.key) - 1
        if (idx < openFiles.length) {
          setActiveFile(openFiles[idx].path)
        }
        return
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
}

/** 保存当前活动文件 */
async function saveActiveFile() {
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

/** 保存所有未保存的文件 */
async function saveAllFiles() {
  const store = useEditorStore.getState()
  for (const f of store.openFiles.filter((f) => f.dirty)) {
    try {
      const content = f.draft ?? f.content
      const res = await wsClient.fileWrite(f.path, content)
      if (res.success) {
        store.markSaved(f.path, content)
        await deleteDraft(f.path)
      }
    } catch { /* skip */ }
  }
}
