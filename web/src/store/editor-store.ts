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

  openFile: (file: Omit<OpenFile, "dirty">) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateDraft: (path: string, draft: string) => void
  markSaved: (path: string, content: string) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,

  openFile: (file) => {
    const { openFiles } = get()
    const existing = openFiles.find((f) => f.path === file.path)
    if (existing) {
      // 已打开：更新服务端内容，保留草稿
      set({
        openFiles: openFiles.map((f) =>
          f.path === file.path
            ? {
                ...f,
                content: file.content,
                // 如果传入了 draft（草稿恢复），使用它；否则保留现有草稿
                draft: file.draft ?? f.draft,
                dirty: (file.draft ?? f.draft ?? file.content) !== file.content,
              }
            : f
        ),
        activeFilePath: file.path,
      })
      return
    }
    set({
      openFiles: [...openFiles, { ...file, dirty: !!file.draft && file.draft !== file.content }],
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

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateDraft: (path, draft) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, draft, dirty: draft !== f.content } : f
      ),
    }))
  },

  markSaved: (path, content) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, draft: undefined, dirty: false } : f
      ),
    }))
  },
}))
