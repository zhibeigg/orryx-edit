import { draftVersionOf } from "@/lib/editor-file-state"
import type { OpenFile } from "@/store/editor-store"
import type { RevisionToken } from "@/types/protocol"

export interface FileSaveSnapshot {
  workspaceId: string
  path: string
  content: string
  baseRevision: RevisionToken
  draftVersion: number
  force: boolean
}

export interface FileSaveSnapshotOptions {
  force?: boolean
  baseRevision?: RevisionToken
  draftVersion?: number
}

export function fileSaveQueueKey(workspaceId: string, path: string): string {
  return `${workspaceId}:${path}`
}

/** 保存调用入口一次性捕获内容、草稿代次与 base revision，排队后不得重新读取。 */
export function captureFileSaveSnapshot(
  file: OpenFile,
  content: string,
  options: FileSaveSnapshotOptions = {},
): FileSaveSnapshot {
  return {
    workspaceId: file.workspaceId,
    path: file.path,
    content,
    baseRevision: options.baseRevision ?? file.revision,
    draftVersion: options.draftVersion ?? draftVersionOf(file),
    force: options.force ?? false,
  }
}
