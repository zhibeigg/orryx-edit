import { create } from "zustand"
import type { ConfigType } from "@/types"

export interface OpenFile {
  path: string
  name: string
  content: string
  configType: ConfigType
  draft?: string // 草稿内容（与 content 不同时表示有未保存的修改）
  dirty: boolean
}

interface EditorState {
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** 最近关闭的文件（用于 Ctrl+Shift+T 重新打开） */
  recentlyClosed: OpenFile[]
  /** 所有已加载文件的内容缓存（path → content），用于交叉引用分析 */
  fileContents: Map<string, string>

  openFile: (file: Omit<OpenFile, "dirty">) => void
  closeFile: (path: string) => void
  closeAllFiles: () => void
  closeSavedFiles: () => void
  setActiveFile: (path: string) => void
  updateDraft: (path: string, draft: string) => void
  markSaved: (path: string, content: string) => void
  /** 重新打开最近关闭的标签页 */
  reopenLastClosed: () => OpenFile | null
  /** 批量缓存文件内容（用于交叉引用分析） */
  cacheFileContent: (path: string, content: string) => void
  cacheFileContents: (files: Map<string, string>) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
  recentlyClosed: [],
  fileContents: new Map(),

  openFile: (file) => {
    const { openFiles } = get()
    const existing = openFiles.find((f) => f.path === file.path)
    if (existing) {
      // 已打开：更新服务端内容，保留草稿
      set({
        openFiles: openFiles.map((f) => {
          if (f.path !== file.path) return f
          const effectiveDraft = file.draft ?? f.draft
          const isDirty = effectiveDraft != null && effectiveDraft !== file.content
          return {
            ...f,
            content: file.content,
            draft: isDirty ? effectiveDraft : undefined,
            dirty: isDirty,
          }
        }),
        activeFilePath: file.path,
      })
      return
    }
    const isDirty = !!file.draft && file.draft !== file.content
    set({
      openFiles: [...openFiles, { ...file, draft: isDirty ? file.draft : undefined, dirty: isDirty }],
      activeFilePath: file.path,
    })
  },

  closeFile: (path) => {
    const { openFiles, activeFilePath, recentlyClosed } = get()
    const closing = openFiles.find((f) => f.path === path)
    const newFiles = openFiles.filter((f) => f.path !== path)
    let newActive = activeFilePath
    if (activeFilePath === path) {
      const idx = openFiles.findIndex((f) => f.path === path)
      newActive = newFiles[Math.min(idx, newFiles.length - 1)]?.path ?? null
    }
    // 记录关闭的文件（最多保留 20 个）
    const newClosed = closing
      ? [closing, ...recentlyClosed.filter(f => f.path !== path)].slice(0, 20)
      : recentlyClosed
    set({ openFiles: newFiles, activeFilePath: newActive, recentlyClosed: newClosed })
  },

  closeAllFiles: () => {
    set({ openFiles: [], activeFilePath: null })
  },

  closeSavedFiles: () => {
    const { openFiles, activeFilePath } = get()
    const remaining = openFiles.filter((f) => f.dirty)
    const newActive = remaining.find((f) => f.path === activeFilePath)?.path ?? remaining[0]?.path ?? null
    set({ openFiles: remaining, activeFilePath: newActive })
  },

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateDraft: (path, draft) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) => {
        if (f.path !== path) return f
        const isDirty = draft !== f.content
        return isDirty
          ? { ...f, draft, dirty: true }
          : { ...f, draft: undefined, dirty: false }
      }),
    }))
  },

  markSaved: (path, content) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, draft: undefined, dirty: false } : f
      ),
    }))
    // 同步更新缓存
    get().cacheFileContent(path, content)
  },

  reopenLastClosed: () => {
    const { recentlyClosed, openFiles } = get()
    if (recentlyClosed.length === 0) return null
    // 跳过已经打开的文件
    const idx = recentlyClosed.findIndex(f => !openFiles.some(o => o.path === f.path))
    if (idx === -1) return null
    const file = recentlyClosed[idx]
    const newClosed = [...recentlyClosed]
    newClosed.splice(idx, 1)
    set({ recentlyClosed: newClosed })
    get().openFile(file)
    return file
  },

  cacheFileContent: (path, content) => {
    set((state) => {
      const newMap = new Map(state.fileContents)
      newMap.set(path, content)
      return { fileContents: newMap }
    })
  },

  cacheFileContents: (files) => {
    set((state) => {
      const newMap = new Map(state.fileContents)
      for (const [k, v] of files) newMap.set(k, v)
      return { fileContents: newMap }
    })
  },
}))
