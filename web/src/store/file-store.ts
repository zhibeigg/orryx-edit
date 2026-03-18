import { create } from "zustand"
import type { FileTreeNode } from "@/types"

interface FileState {
  fileTree: FileTreeNode[]
  loading: boolean

  setFileTree: (files: FileTreeNode[]) => void
  setLoading: (loading: boolean) => void
}

export const useFileStore = create<FileState>((set) => ({
  fileTree: [],
  loading: false,

  setFileTree: (files) => set({ fileTree: files, loading: false }),
  setLoading: (loading) => set({ loading }),
}))
