import { deleteDraftSnapshotIfUnchanged, persistDraftSnapshot } from "@/lib/draft-consistency"
import {
  acknowledgeSavedRevision,
  invalidateAcknowledgedRevisionChain,
  resolveAcknowledgedSaveRevision,
} from "@/lib/acknowledged-revision-chain"
import { canCloseAfterSaving } from "@/lib/editor-file-state"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import {
  captureFileSaveSnapshot,
  fileSaveQueueKey,
  type FileSaveSnapshotOptions,
} from "@/lib/file-save-snapshot"
import { isFileOperationBlocked } from "@/lib/file-operation-guard"
import { createKeyedSerialQueue } from "@/lib/keyed-serial-queue"
import { wsClient, WsRequestError } from "@/lib/ws-client"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

export type SaveEditorFileOptions = FileSaveSnapshotOptions

const fileSaveQueue = createKeyedSerialQueue()

export function waitForFileSaveQueues(
  workspaceId: string,
  matches: (path: string) => boolean,
): Promise<void> {
  const prefix = `${workspaceId}:`
  return fileSaveQueue.waitForMatching(
    (key) => key.startsWith(prefix) && matches(key.slice(prefix.length)),
  )
}

async function syncPersistedDraft(workspaceId: string, path: string, acknowledgedContent: string) {
  const state = useEditorStore.getState()
  if (state.workspaceId !== workspaceId) return
  const current = state.openFiles.find((file) => file.workspaceId === workspaceId && file.path === path)
  if (current?.dirty && current.draft != null) {
    await persistDraftSnapshot(workspaceId, current)
  } else {
    await deleteDraftSnapshotIfUnchanged(workspaceId, path, acknowledgedContent)
  }
}

export async function saveEditorFile(
  file: OpenFile,
  content: string,
  options: boolean | SaveEditorFileOptions = false,
): Promise<boolean> {
  const normalizedOptions = typeof options === "boolean" ? { force: options } : options
  const snapshot = captureFileSaveSnapshot(file, content, normalizedOptions)
  const queueKey = fileSaveQueueKey(snapshot.workspaceId, snapshot.path)
  if (isFileOperationBlocked(snapshot.workspaceId, snapshot.path)) {
    useEditorStore.getState().setLifecycleError("文件正在删除、重命名或重新同步，当前保存已取消。请稍后重试。")
    return false
  }

  return fileSaveQueue.enqueue(queueKey, async () => {
    // 旧 workspace 的排队任务不得在认证切换后使用新会话写入同路径文件。
    if (useEditorStore.getState().workspaceId !== snapshot.workspaceId) return false
    if (isFileOperationBlocked(snapshot.workspaceId, snapshot.path)) return false

    const currentBeforeSave = useEditorStore.getState().openFiles.find(
      (candidate) => candidate.workspaceId === snapshot.workspaceId && candidate.path === snapshot.path,
    )
    if (!snapshot.force && currentBeforeSave?.externalRevision != null) {
      useEditorStore.getState().setSaveConflict({
        workspaceId: snapshot.workspaceId,
        path: snapshot.path,
        attemptedContent: snapshot.content,
        currentRevision: currentBeforeSave.externalRevision,
        attemptedDraftVersion: snapshot.draftVersion,
      })
      return false
    }

    const effectiveBaseRevision = resolveAcknowledgedSaveRevision(
      queueKey,
      snapshot.baseRevision,
      snapshot.force,
    )

    try {
      const result = await wsClient.fileWrite(
        snapshot.path,
        snapshot.content,
        effectiveBaseRevision,
        snapshot.force,
      )
      if (!result.success || useEditorStore.getState().workspaceId !== snapshot.workspaceId) return false

      useEditorStore.getState().applyServerSnapshot(
        snapshot.workspaceId,
        snapshot.path,
        snapshot.content,
        result.revision,
        snapshot.draftVersion,
      )
      const current = useEditorStore.getState().openFiles.find(
        (file) => file.workspaceId === snapshot.workspaceId && file.path === snapshot.path,
      )
      if (current?.externalRevision != null && current.externalRevision !== result.revision) {
        invalidateAcknowledgedRevisionChain(queueKey)
      } else {
        acknowledgeSavedRevision(
          queueKey,
          snapshot.baseRevision,
          effectiveBaseRevision,
          result.revision,
        )
      }
      await syncPersistedDraft(snapshot.workspaceId, snapshot.path, snapshot.content)
      return true
    } catch (error) {
      if (error instanceof WsRequestError && error.code === "REVISION_CONFLICT") {
        invalidateAcknowledgedRevisionChain(queueKey)
        useEditorStore.getState().setSaveConflict({
          workspaceId: snapshot.workspaceId,
          path: snapshot.path,
          attemptedContent: snapshot.content,
          currentRevision: error.data.currentRevision ?? effectiveBaseRevision,
          attemptedDraftVersion: snapshot.draftVersion,
        })
        return false
      }
      throw error
    }
  })
}

export async function saveAllEditorFiles(): Promise<boolean> {
  if (!flushEditorInputs()) return false

  const state = useEditorStore.getState()
  const workspaceId = state.workspaceId
  if (!workspaceId) return false
  const snapshots = state.openFiles
    .filter((file) => file.workspaceId === workspaceId && file.dirty)
    .map((file) => ({
      file,
      content: file.draft ?? file.content,
      options: {
        baseRevision: file.revision,
        draftVersion: file.draftVersion ?? 0,
      },
    }))

  let allSucceeded = true
  for (const snapshot of snapshots) {
    try {
      const success = await saveEditorFile(snapshot.file, snapshot.content, snapshot.options)
      if (!success) allSucceeded = false
    } catch {
      allSucceeded = false
    }
  }

  const finalState = useEditorStore.getState()
  if (finalState.workspaceId !== workspaceId) return false
  return canCloseAfterSaving(allSucceeded, finalState.openFiles)
}
