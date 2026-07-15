import { create } from "zustand"
import { persistDraftSnapshots } from "@/lib/draft-consistency"
import {
  clearAcknowledgedRevisionChainsForWorkspace,
  invalidateAcknowledgedRevisionChain,
} from "@/lib/acknowledged-revision-chain"
import { fileSaveQueueKey } from "@/lib/file-save-snapshot"
import {
  applyAcknowledgedSnapshot,
  hasExternalRevision,
  reconcileServerSnapshot as reconcileFileServerSnapshot,
  updateFileDraft,
} from "@/lib/editor-file-state"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import type { ConfigType } from "@/types"
import type { RevisionToken } from "@/types/protocol"

export interface OpenFile {
  workspaceId: string
  path: string
  name: string
  content: string
  configType: ConfigType
  revision: RevisionToken
  externalRevision?: RevisionToken
  draft?: string // 草稿内容（与 content 不同时表示有未保存的修改）
  dirty: boolean
  draftVersion?: number
}

export interface SaveConflict {
  workspaceId: string
  path: string
  attemptedContent: string
  currentRevision: RevisionToken
  attemptedDraftVersion: number
}

interface EditorState {
  workspaceId: string | null
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** 最近关闭的文件（用于 Ctrl+Shift+T 重新打开） */
  recentlyClosed: OpenFile[]
  /** 所有已加载文件的内容缓存（path → content），用于交叉引用分析 */
  fileContents: Map<string, string>
  saveConflict: SaveConflict | null
  lifecycleError: string | null

  setWorkspace: (workspaceId: string | null) => Promise<boolean>
  openFile: (file: Omit<OpenFile, "dirty" | "revision" | "workspaceId"> & { revision?: RevisionToken; workspaceId?: string }) => boolean
  closeFile: (path: string) => Promise<boolean>
  closeAllFiles: () => Promise<boolean>
  closeSavedFiles: () => Promise<boolean>
  setActiveFile: (path: string) => boolean
  updateDraft: (path: string, draft: string) => void
  applyServerSnapshot: (workspaceId: string, path: string, content: string, revision: RevisionToken, acknowledgedDraftVersion: number) => void
  reconcileServerSnapshot: (workspaceId: string, path: string, content: string, revision: RevisionToken, requireDirtyConflict: boolean) => void
  markExternalChange: (workspaceId: string, path: string, revision: RevisionToken) => void
  markRevisionUnverified: (workspaceId: string, path: string) => void
  setSaveConflict: (conflict: SaveConflict | null) => void
  setLifecycleError: (message: string | null) => void
  clearLifecycleError: () => void
  /** 重新打开最近关闭的标签页 */
  reopenLastClosed: () => OpenFile | null
  /** 批量缓存文件内容（用于交叉引用分析） */
  cacheFileContent: (workspaceId: string, path: string, content: string) => void
  cacheFileContents: (workspaceId: string, files: Map<string, string>) => void
}

const emptyEditorState = () => ({
  openFiles: [] as OpenFile[],
  activeFilePath: null as string | null,
  recentlyClosed: [] as OpenFile[],
  fileContents: new Map<string, string>(),
  saveConflict: null as SaveConflict | null,
  lifecycleError: null as string | null,
})

const DRAFT_PERSISTENCE_ERROR = "草稿写入浏览器存储失败，标签或工作区未关闭。请检查浏览器存储权限与剩余空间后重试。"
const INPUT_FLUSH_ERROR = "当前编辑内容无法安全提交，已取消关闭或切换。请修正编辑器中的无效内容后重试。"

function dirtyDraftSignature(files: readonly OpenFile[]): string {
  return JSON.stringify(files
    .filter((file) => file.dirty && file.draft != null)
    .map((file) => [file.path, file.content, file.revision, file.draft, file.draftVersion ?? 0]))
}

async function persistStableDrafts(
  workspaceId: string | null,
  readFiles: () => readonly OpenFile[],
): Promise<void> {
  if (!workspaceId) return
  while (true) {
    const snapshot = [...readFiles()]
    const signature = dirtyDraftSignature(snapshot)
    await persistDraftSnapshots(workspaceId, snapshot)
    if (dirtyDraftSignature(readFiles()) === signature) return
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workspaceId: null,
  ...emptyEditorState(),

  setWorkspace: async (workspaceId) => {
    const currentWorkspaceId = get().workspaceId
    if (currentWorkspaceId === workspaceId) return true
    if (!flushEditorInputs()) {
      set({ lifecycleError: INPUT_FLUSH_ERROR })
      return false
    }

    try {
      await persistStableDrafts(currentWorkspaceId, () => {
        const state = get()
        return state.workspaceId === currentWorkspaceId ? state.openFiles : []
      })
    } catch {
      set({ lifecycleError: DRAFT_PERSISTENCE_ERROR })
      return false
    }

    if (get().workspaceId !== currentWorkspaceId) return get().workspaceId === workspaceId
    clearAcknowledgedRevisionChainsForWorkspace(currentWorkspaceId)
    set({ workspaceId, ...emptyEditorState() })
    return true
  },

  openFile: (file) => {
    const state = get()
    const workspaceId = file.workspaceId ?? state.workspaceId
    if (!workspaceId || workspaceId !== state.workspaceId) return false
    if (state.activeFilePath !== file.path && !flushEditorInputs()) return false

    const normalizedFile = { ...file, workspaceId, revision: file.revision ?? 0 }
    const current = get()
    const existing = current.openFiles.find((candidate) => candidate.path === normalizedFile.path)
    if (existing) {
      // 已有 dirty 草稿时只激活标签，不把后来读取到的 revision 塞到旧草稿下面。
      if (existing.dirty) {
        set({ activeFilePath: normalizedFile.path })
        return true
      }

      const isDirty = normalizedFile.draft != null && normalizedFile.draft !== normalizedFile.content
      set({
        openFiles: current.openFiles.map((candidate) => candidate.path === normalizedFile.path
          ? {
              ...candidate,
              ...normalizedFile,
              draft: isDirty ? normalizedFile.draft : undefined,
              dirty: isDirty,
              draftVersion: normalizedFile.draftVersion ?? (isDirty ? 1 : candidate.draftVersion ?? 0),
            }
          : candidate),
        activeFilePath: normalizedFile.path,
      })
      return true
    }

    const isDirty = normalizedFile.draft != null && normalizedFile.draft !== normalizedFile.content
    set({
      openFiles: [...current.openFiles, {
        ...normalizedFile,
        draft: isDirty ? normalizedFile.draft : undefined,
        dirty: isDirty,
        draftVersion: normalizedFile.draftVersion ?? (isDirty ? 1 : 0),
      }],
      activeFilePath: normalizedFile.path,
    })
    return true
  },

  closeFile: async (path) => {
    if (!flushEditorInputs()) {
      set({ lifecycleError: INPUT_FLUSH_ERROR })
      return false
    }
    const workspaceId = get().workspaceId
    try {
      await persistStableDrafts(workspaceId, () => get().openFiles.filter((file) => file.path === path))
    } catch {
      set({ lifecycleError: DRAFT_PERSISTENCE_ERROR })
      return false
    }

    const { workspaceId: latestWorkspaceId, openFiles, activeFilePath, recentlyClosed } = get()
    if (latestWorkspaceId !== workspaceId) return false
    const closing = openFiles.find((file) => file.path === path)
    if (!closing) return true

    const newFiles = openFiles.filter((file) => file.path !== path)
    let newActive = activeFilePath
    if (activeFilePath === path) {
      const index = openFiles.findIndex((file) => file.path === path)
      newActive = newFiles[Math.min(index, newFiles.length - 1)]?.path ?? null
    }
    const newClosed = [closing, ...recentlyClosed.filter((file) => file.path !== path)].slice(0, 20)
    set({ openFiles: newFiles, activeFilePath: newActive, recentlyClosed: newClosed, lifecycleError: null })
    return true
  },

  closeAllFiles: async () => {
    if (!flushEditorInputs()) {
      set({ lifecycleError: INPUT_FLUSH_ERROR })
      return false
    }
    const workspaceId = get().workspaceId
    try {
      await persistStableDrafts(workspaceId, () => get().openFiles)
    } catch {
      set({ lifecycleError: DRAFT_PERSISTENCE_ERROR })
      return false
    }
    if (get().workspaceId !== workspaceId) return false
    set({ openFiles: [], activeFilePath: null, lifecycleError: null })
    return true
  },

  closeSavedFiles: async () => {
    if (!flushEditorInputs()) {
      set({ lifecycleError: INPUT_FLUSH_ERROR })
      return false
    }
    const { openFiles, activeFilePath } = get()
    const remaining = openFiles.filter((file) => file.dirty)
    const newActive = remaining.find((file) => file.path === activeFilePath)?.path ?? remaining[0]?.path ?? null
    set({ openFiles: remaining, activeFilePath: newActive, lifecycleError: null })
    return true
  },

  setActiveFile: (path) => {
    const state = get()
    if (state.activeFilePath === path) return true
    if (!state.openFiles.some((file) => file.path === path) || !flushEditorInputs()) return false
    set({ activeFilePath: path })
    return true
  },

  updateDraft: (path, draft) => {
    set((state) => ({
      openFiles: state.openFiles.map((file) => file.path === path ? updateFileDraft(file, draft) : file),
    }))
  },

  applyServerSnapshot: (workspaceId, path, content, revision, acknowledgedDraftVersion) => {
    if (get().workspaceId !== workspaceId) return
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.workspaceId === workspaceId && file.path === path
          ? applyAcknowledgedSnapshot(file, content, revision, acknowledgedDraftVersion)
          : file
      ),
      saveConflict: state.saveConflict?.workspaceId === workspaceId && state.saveConflict.path === path
        ? null
        : state.saveConflict,
    }))
    get().cacheFileContent(workspaceId, path, content)
  },

  reconcileServerSnapshot: (workspaceId, path, content, revision, requireDirtyConflict) => {
    if (get().workspaceId !== workspaceId) return
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.workspaceId === workspaceId && file.path === path
          ? reconcileFileServerSnapshot(file, content, revision, requireDirtyConflict)
          : file
      ),
      saveConflict: state.saveConflict?.workspaceId === workspaceId && state.saveConflict.path === path
        ? null
        : state.saveConflict,
    }))
    get().cacheFileContent(workspaceId, path, content)
  },

  markExternalChange: (workspaceId, path, revision) => {
    if (get().workspaceId !== workspaceId) return
    invalidateAcknowledgedRevisionChain(fileSaveQueueKey(workspaceId, path))
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.workspaceId === workspaceId && file.path === path && hasExternalRevision(file.revision, revision)
          ? { ...file, externalRevision: revision }
          : file
      ),
    }))
  },

  markRevisionUnverified: (workspaceId, path) => {
    if (get().workspaceId !== workspaceId) return
    invalidateAcknowledgedRevisionChain(fileSaveQueueKey(workspaceId, path))
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.workspaceId === workspaceId && file.path === path
          ? { ...file, externalRevision: file.externalRevision ?? file.revision }
          : file
      ),
    }))
  },

  setSaveConflict: (saveConflict) => {
    if (saveConflict && get().workspaceId !== saveConflict.workspaceId) return
    set({ saveConflict })
  },

  setLifecycleError: (lifecycleError) => set({ lifecycleError }),
  clearLifecycleError: () => set({ lifecycleError: null }),

  reopenLastClosed: () => {
    const { workspaceId, recentlyClosed, openFiles } = get()
    if (!workspaceId || recentlyClosed.length === 0) return null
    const index = recentlyClosed.findIndex((file) => file.workspaceId === workspaceId && !openFiles.some((open) => open.path === file.path))
    if (index === -1) return null
    const file = recentlyClosed[index]
    const newClosed = [...recentlyClosed]
    newClosed.splice(index, 1)
    set({ recentlyClosed: newClosed })
    return get().openFile(file) ? file : null
  },

  cacheFileContent: (workspaceId, path, content) => {
    if (get().workspaceId !== workspaceId) return
    set((state) => {
      const newMap = new Map(state.fileContents)
      newMap.set(path, content)
      return { fileContents: newMap }
    })
  },

  cacheFileContents: (workspaceId, files) => {
    if (get().workspaceId !== workspaceId) return
    set((state) => {
      const newMap = new Map(state.fileContents)
      for (const [key, value] of files) newMap.set(key, value)
      return { fileContents: newMap }
    })
  },
}))
