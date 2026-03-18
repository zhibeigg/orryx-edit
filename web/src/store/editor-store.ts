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
  /** 所有已加载文件的内容缓存（path → content），用于交叉引用分析 */
  fileContents: Map<string, string>

  openFile: (file: Omit<OpenFile, "dirty">) => void
  closeFile: (path: string) => void
  closeAllFiles: () => void
  closeSavedFiles: () => void
  setActiveFile: (path: string) => void
  updateDraft: (path: string, draft: string) => void
  markSaved: (path: string, content: string) => void
  /** 批量缓存文件内容（用于交叉引用分析） */
  cacheFileContent: (path: string, content: string) => void
  cacheFileContents: (files: Map<string, string>) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
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
    const { openFiles, activeFilePath } = get()
    const newFiles = openFiles.filter((f) => f.path !== path)
    let newActive = activeFilePath
    if (activeFilePath === path) {
      const idx = openFiles.findIndex((f) => f.path === path)
      newActive = newFiles[Math.min(idx, newFiles.length - 1)]?.path ?? null
    }
    set({ openFiles: newFiles, activeFilePath: newActive })
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
