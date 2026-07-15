import { deleteDraftSnapshotIfUnchanged, persistDraftSnapshot } from "@/lib/draft-consistency"
import {
  clearAcknowledgedRevisionChainsForWorkspace,
  invalidateAcknowledgedRevisionChain,
} from "@/lib/acknowledged-revision-chain"
import { fileSaveQueueKey } from "@/lib/file-save-snapshot"
import { draftVersionOf } from "@/lib/editor-file-state"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import { acquireFileOperationLock, fileOperationEpoch, isFileOperationBlocked } from "@/lib/file-operation-guard"
import { waitForFileSaveQueues } from "@/lib/file-save"
import { tryRestoreDraft } from "@/lib/use-draft-sync"
import { wsClient } from "@/lib/ws-client"
import { useEditorStore } from "@/store/editor-store"
import { getConfigType } from "@/types"

const openGenerations = new Map<string, number>()

function requireWorkspaceId(): string {
  const workspaceId = useEditorStore.getState().workspaceId
  if (!workspaceId) throw new Error("当前没有已绑定的编辑工作区")
  return workspaceId
}

function openGenerationKey(workspaceId: string, path: string): string {
  return `${workspaceId}:${path}`
}

function nextOpenGeneration(workspaceId: string, path: string): number {
  const key = openGenerationKey(workspaceId, path)
  const generation = (openGenerations.get(key) ?? 0) + 1
  openGenerations.set(key, generation)
  return generation
}

function isCurrentOpenGeneration(workspaceId: string, path: string, generation: number): boolean {
  return useEditorStore.getState().workspaceId === workspaceId
    && openGenerations.get(openGenerationKey(workspaceId, path)) === generation
}

export function readServerFile(path: string) {
  return wsClient.fileRead(path)
}

export async function openServerFile(path: string, name = path.split("/").pop() ?? path): Promise<void> {
  const workspaceId = requireWorkspaceId()
  if (isFileOperationBlocked(workspaceId, path)) {
    throw new Error("文件正在删除、重命名或重新同步，请稍后重试。")
  }
  const existing = useEditorStore.getState().openFiles.find((file) => file.workspaceId === workspaceId && file.path === path)
  if (existing) {
    useEditorStore.getState().setActiveFile(path)
    return
  }

  const generation = nextOpenGeneration(workspaceId, path)
  const operationEpoch = fileOperationEpoch(workspaceId)
  const response = await readServerFile(path)
  const restored = await tryRestoreDraft(workspaceId, path, response.content, response.revision)
  if (!isCurrentOpenGeneration(workspaceId, path, generation)
    || fileOperationEpoch(workspaceId) !== operationEpoch
    || isFileOperationBlocked(workspaceId, path)) return

  invalidateAcknowledgedRevisionChain(fileSaveQueueKey(workspaceId, path))
  useEditorStore.getState().openFile({
    workspaceId,
    path,
    name,
    content: restored.serverContent,
    revision: restored.baseRevision,
    configType: getConfigType(path),
    ...(restored.hasDraft ? {
      draft: restored.content,
      draftVersion: restored.draftVersion,
      externalRevision: restored.externalRevision,
    } : {}),
  })
}

export async function reloadEditorFileFromServer(
  path: string,
  acknowledgedDraftVersion: number,
  acknowledgedDraftContent?: string,
) {
  const workspaceId = requireWorkspaceId()
  const latest = await readServerFile(path)
  if (useEditorStore.getState().workspaceId !== workspaceId) return latest

  invalidateAcknowledgedRevisionChain(fileSaveQueueKey(workspaceId, path))
  const current = useEditorStore.getState().openFiles.find((file) => file.workspaceId === workspaceId && file.path === path)
  if (!current) return latest

  // 读取期间又发生输入时，不能把新 revision 塞到基于旧 revision 的草稿下；仅标记外部变化。
  if (draftVersionOf(current) !== acknowledgedDraftVersion) {
    useEditorStore.getState().markExternalChange(workspaceId, path, latest.revision)
    if (current.dirty && current.draft != null) await persistDraftSnapshot(workspaceId, current)
    return latest
  }

  useEditorStore.getState().applyServerSnapshot(
    workspaceId,
    path,
    latest.content,
    latest.revision,
    acknowledgedDraftVersion,
  )

  const applied = useEditorStore.getState().openFiles.find((file) => file.workspaceId === workspaceId && file.path === path)
  if (applied?.dirty && applied.draft != null) {
    await persistDraftSnapshot(workspaceId, applied)
  } else if (acknowledgedDraftContent != null) {
    await deleteDraftSnapshotIfUnchanged(workspaceId, path, acknowledgedDraftContent)
  }

  return latest
}

const workspaceResynchronizationTails = new Map<string, Promise<boolean>>()

async function performOpenFileResynchronization(workspaceId: string): Promise<boolean> {
  const release = acquireFileOperationLock(workspaceId, () => true)
  try {
    clearAcknowledgedRevisionChainsForWorkspace(workspaceId)
    await waitForFileSaveQueues(workspaceId, () => true)
    clearAcknowledgedRevisionChainsForWorkspace(workspaceId)

    if (useEditorStore.getState().workspaceId !== workspaceId) return false
    if (!flushEditorInputs()) {
      useEditorStore.getState().setLifecycleError("重连后无法安全提交当前编辑器输入，服务器文件尚未刷新。请修正无效输入后重新连接。")
      return false
    }

    const paths = useEditorStore.getState().openFiles
      .filter((file) => file.workspaceId === workspaceId)
      .map((file) => file.path)
    const results = await Promise.allSettled(paths.map(async (path) => ({
      path,
      snapshot: await readServerFile(path),
    })))
    if (useEditorStore.getState().workspaceId !== workspaceId) return false

    let failed = 0
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed += 1
        useEditorStore.getState().markRevisionUnverified(workspaceId, paths[index])
        continue
      }
      const { path, snapshot } = result.value
      useEditorStore.getState().reconcileServerSnapshot(
        workspaceId,
        path,
        snapshot.content,
        snapshot.revision,
        true,
      )
    }

    clearAcknowledgedRevisionChainsForWorkspace(workspaceId)
    const dirtyFiles = useEditorStore.getState().openFiles.filter(
      (file) => file.workspaceId === workspaceId && file.dirty && file.draft != null,
    )
    try {
      await Promise.all(dirtyFiles.map((file) => persistDraftSnapshot(workspaceId, file)))
    } catch {
      useEditorStore.getState().setLifecycleError("服务器文件已刷新，但冲突草稿写入浏览器存储失败。请勿关闭页面并尽快处理。")
      return false
    }

    useEditorStore.getState().setLifecycleError(failed > 0
      ? `重连后有 ${failed} 个已打开文件读取失败；这些标签已保留且不会使用旧 revision 自动保存。`
      : null)
    return failed === 0
  } finally {
    clearAcknowledgedRevisionChainsForWorkspace(workspaceId)
    release()
  }
}

/**
 * 任何会话重连或插件协议域重新注册后，都重新读取已打开文件。
 * 同 workspace 的重复通知按到达顺序串行执行，避免权威插件快速切换时后一次刷新被前一次合并掉。
 * clean 文件直接刷新；dirty 文件换到新的 revision 域并强制进入显式冲突处理，避免旧 V1/V2 base 被再次发送。
 */
export function resynchronizeOpenFiles(workspaceId: string): Promise<boolean> {
  const previous = workspaceResynchronizationTails.get(workspaceId)
  const resynchronization = previous
    ? previous.catch(() => false).then(() => performOpenFileResynchronization(workspaceId))
    : performOpenFileResynchronization(workspaceId)
  workspaceResynchronizationTails.set(workspaceId, resynchronization)
  return resynchronization.finally(() => {
    if (workspaceResynchronizationTails.get(workspaceId) === resynchronization) {
      workspaceResynchronizationTails.delete(workspaceId)
    }
  })
}
