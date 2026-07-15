import {
  invalidateAcknowledgedRevisionChainsMatching,
} from "@/lib/acknowledged-revision-chain"
import {
  persistDraftSnapshots,
  waitForDraftMutationsMatching,
} from "@/lib/draft-consistency"
import {
  deleteDraft,
  listStoredDrafts,
  loadDraft,
  persistDraftPathInvalidation,
  saveDraft,
  type StoredDraft,
  type StoredDraftEntry,
} from "@/lib/draft-storage"
import { reconcileServerSnapshot as reconcileFileServerSnapshot } from "@/lib/editor-file-state"
import { flushEditorInputs } from "@/lib/editor-input-flush"
import { acquireFileOperationLock } from "@/lib/file-operation-guard"
import { waitForFileSaveQueues } from "@/lib/file-save"
import { wsClient, type FileReadResult } from "@/lib/ws-client"
import { useEditorStore, type OpenFile, type SaveConflict } from "@/store/editor-store"
import { getConfigType } from "@/types"

export interface FileLifecycleResult {
  success: boolean
  changed: boolean
  message: string
}

interface IndexedFile {
  file: OpenFile
  index: number
}

interface DetachedEditorPaths {
  workspaceId: string
  openFiles: IndexedFile[]
  recentlyClosed: IndexedFile[]
  fileContents: Array<[string, string]>
  activeFilePath: string | null
  saveConflict: SaveConflict | null
}

interface DraftRollbackResult {
  unsafePaths: string[]
}

const INPUT_FLUSH_ERROR = "当前编辑器存在无法提交的输入，已取消文件操作。请修正无效内容后重试。"
const DRAFT_PERSISTENCE_ERROR = "草稿写入浏览器存储失败，未执行远端文件操作。请检查浏览器存储后重试。"

export function pathMatchesTarget(path: string, targetPath: string, isDirectory: boolean): boolean {
  return path === targetPath || (isDirectory && path.startsWith(`${targetPath}/`))
}

export function remapTargetPath(
  path: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string {
  if (!pathMatchesTarget(path, oldPath, isDirectory)) return path
  return path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`
}

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

function affectedDraftSignature(files: readonly OpenFile[]): string {
  return JSON.stringify(files.map((file) => [
    file.path,
    file.content,
    file.revision,
    file.externalRevision,
    file.draft,
    file.dirty,
    file.draftVersion ?? 0,
  ]))
}

async function persistStableAffectedDrafts(
  workspaceId: string,
  matches: (path: string) => boolean,
): Promise<void> {
  while (true) {
    if (!flushEditorInputs()) throw new Error(INPUT_FLUSH_ERROR)
    const snapshot = useEditorStore.getState().openFiles.filter(
      (file) => file.workspaceId === workspaceId && matches(file.path),
    )
    const signature = affectedDraftSignature(snapshot)
    await persistDraftSnapshots(workspaceId, snapshot, { allowDuringFileOperation: true })
    if (!flushEditorInputs()) throw new Error(INPUT_FLUSH_ERROR)
    const latest = useEditorStore.getState().openFiles.filter(
      (file) => file.workspaceId === workspaceId && matches(file.path),
    )
    if (affectedDraftSignature(latest) === signature) return
  }
}

function detachEditorPaths(workspaceId: string, matches: (path: string) => boolean): DetachedEditorPaths {
  let detached: DetachedEditorPaths | null = null
  useEditorStore.setState((state) => {
    if (state.workspaceId !== workspaceId) return state

    const openFiles = state.openFiles
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => matches(file.path))
    const recentlyClosed = state.recentlyClosed
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => matches(file.path))
    const fileContents = [...state.fileContents.entries()].filter(([path]) => matches(path))
    const activeFilePath = state.activeFilePath != null && matches(state.activeFilePath)
      ? state.activeFilePath
      : null
    const saveConflict = state.saveConflict != null && matches(state.saveConflict.path)
      ? state.saveConflict
      : null

    detached = {
      workspaceId,
      openFiles,
      recentlyClosed,
      fileContents,
      activeFilePath,
      saveConflict,
    }

    const remainingOpenFiles = state.openFiles.filter((file) => !matches(file.path))
    const activeIndex = activeFilePath == null
      ? -1
      : state.openFiles.findIndex((file) => file.path === activeFilePath)
    const nextActiveFilePath = activeFilePath == null
      ? state.activeFilePath
      : remainingOpenFiles[Math.min(activeIndex, remainingOpenFiles.length - 1)]?.path ?? null
    const nextContents = new Map(state.fileContents)
    for (const [path] of fileContents) nextContents.delete(path)

    return {
      openFiles: remainingOpenFiles,
      activeFilePath: nextActiveFilePath,
      recentlyClosed: state.recentlyClosed.filter((file) => !matches(file.path)),
      fileContents: nextContents,
      saveConflict: saveConflict ? null : state.saveConflict,
    }
  })

  if (!detached) throw new Error("文件操作期间工作区已改变，已取消远端操作。")
  return detached
}

function insertFilesAtOriginalPositions(current: OpenFile[], entries: IndexedFile[]): OpenFile[] {
  const next = [...current]
  for (const { file, index } of [...entries].sort((left, right) => left.index - right.index)) {
    const duplicate = next.findIndex((candidate) => candidate.path === file.path)
    if (duplicate >= 0) next.splice(duplicate, 1)
    next.splice(Math.min(index, next.length), 0, file)
  }
  return next
}

function restoreDetachedEditorPaths(
  detached: DetachedEditorPaths,
  mapPath: (path: string) => string,
  serverSnapshots: ReadonlyMap<string, FileReadResult | null> = new Map(),
) {
  const transformFile = (file: OpenFile): OpenFile => {
    const path = mapPath(file.path)
    const renamed = {
      ...file,
      path,
      name: basename(path),
      configType: getConfigType(path),
    }
    if (!serverSnapshots.has(file.path)) return renamed
    const latest = serverSnapshots.get(file.path)
    if (!latest) return { ...renamed, externalRevision: renamed.externalRevision ?? renamed.revision }
    return reconcileFileServerSnapshot(renamed, latest.content, latest.revision, false)
  }

  const openFiles = detached.openFiles.map(({ file, index }) => ({ file: transformFile(file), index }))
  const recentlyClosed = detached.recentlyClosed.map(({ file, index }) => ({ file: transformFile(file), index }))
  const mappedPaths = new Set([
    ...openFiles.map(({ file }) => file.path),
    ...recentlyClosed.map(({ file }) => file.path),
  ])

  useEditorStore.setState((state) => {
    if (state.workspaceId !== detached.workspaceId) return state
    const withoutMappedOpenFiles = state.openFiles.filter((file) => !mappedPaths.has(file.path))
    const withoutMappedRecentlyClosed = state.recentlyClosed.filter((file) => !mappedPaths.has(file.path))
    const nextContents = new Map(state.fileContents)
    for (const [oldPath, content] of detached.fileContents) {
      const path = mapPath(oldPath)
      const latest = serverSnapshots.get(oldPath)
      nextContents.set(path, latest?.content ?? content)
    }

    const activeFilePath = detached.activeFilePath == null
      ? state.activeFilePath
      : mapPath(detached.activeFilePath)
    const restoredSaveConflict = detached.saveConflict == null
      ? null
      : {
          ...detached.saveConflict,
          path: mapPath(detached.saveConflict.path),
          currentRevision: serverSnapshots.get(detached.saveConflict.path)?.revision
            ?? detached.saveConflict.currentRevision,
        }
    const saveConflict = state.saveConflict ?? restoredSaveConflict

    return {
      openFiles: insertFilesAtOriginalPositions(withoutMappedOpenFiles, openFiles),
      activeFilePath,
      recentlyClosed: insertFilesAtOriginalPositions(withoutMappedRecentlyClosed, recentlyClosed).slice(0, 20),
      fileContents: nextContents,
      saveConflict,
    }
  })
}

function storedDraftPayload(draft: StoredDraft): Omit<StoredDraft, "savedAt" | "workspaceId"> {
  return {
    content: draft.content,
    baseContent: draft.baseContent,
    baseRevision: draft.baseRevision,
    draftVersion: draft.draftVersion,
    requiresConflictResolution: draft.requiresConflictResolution,
  }
}

function maximumSavedAt(entries: readonly StoredDraftEntry[]): number {
  return entries.reduce((maximum, entry) => Math.max(maximum, entry.draft.savedAt), 0)
}

async function captureAffectedDrafts(
  workspaceId: string,
  matches: (path: string) => boolean,
): Promise<StoredDraftEntry[]> {
  await waitForDraftMutationsMatching(workspaceId, matches)
  return (await listStoredDrafts(workspaceId)).filter(({ path }) => matches(path))
}

async function restoreCapturedDrafts(
  workspaceId: string,
  entries: readonly StoredDraftEntry[],
): Promise<string[]> {
  const results = await Promise.allSettled(entries.map(async ({ path, draft }) => {
    const restored = await saveDraft(workspaceId, path, storedDraftPayload(draft))
    const verified = await loadDraft(workspaceId, path)
    if (!verified || verified.savedAt !== restored.savedAt || verified.content !== draft.content) {
      throw new Error(`无法验证草稿 ${path} 的恢复结果。`)
    }
  }))
  return results.flatMap((result, index) => result.status === "rejected" ? [entries[index].path] : [])
}

async function deleteCapturedDrafts(
  workspaceId: string,
  entries: readonly StoredDraftEntry[],
): Promise<string[]> {
  const results = await Promise.allSettled(entries.map(({ path }) => deleteDraft(workspaceId, path)))
  return results.flatMap((result, index) => result.status === "rejected" ? [entries[index].path] : [])
}

async function assertRenameTargetsAvailable(
  workspaceId: string,
  sourceEntries: readonly StoredDraftEntry[],
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): Promise<void> {
  const sourcePaths = new Set(sourceEntries.map(({ path }) => path))
  const activePaths = new Set((await listStoredDrafts(workspaceId)).map(({ path }) => path))
  for (const activePath of activePaths) {
    if (pathMatchesTarget(activePath, newPath, isDirectory) && !sourcePaths.has(activePath)) {
      throw new Error(`目标路径 ${activePath} 已存在本地草稿，已取消重命名以避免覆盖。`)
    }
  }
  for (const { path } of sourceEntries) {
    const targetPath = remapTargetPath(path, oldPath, newPath, isDirectory)
    if (activePaths.has(targetPath) && !sourcePaths.has(targetPath)) {
      throw new Error(`目标路径 ${targetPath} 已存在本地草稿，已取消重命名以避免覆盖。`)
    }
  }
}

async function migrateCapturedDrafts(
  workspaceId: string,
  sourceEntries: readonly StoredDraftEntry[],
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): Promise<StoredDraftEntry[]> {
  const migrated: StoredDraftEntry[] = []
  for (const { path, draft } of sourceEntries) {
    const targetPath = remapTargetPath(path, oldPath, newPath, isDirectory)
    const stored = await saveDraft(workspaceId, targetPath, storedDraftPayload(draft))
    const verified = await loadDraft(workspaceId, targetPath)
    if (!verified || verified.savedAt !== stored.savedAt || verified.content !== draft.content) {
      throw new Error(`无法验证新路径草稿 ${targetPath}，已取消远端重命名。`)
    }
    migrated.push({ path: targetPath, draft: stored })
  }
  return migrated
}

async function rollbackMigratedDrafts(
  workspaceId: string,
  newPath: string,
  isDirectory: boolean,
  targetPaths: readonly string[],
  minimumCutoff: number,
): Promise<DraftRollbackResult> {
  if (targetPaths.length === 0) return { unsafePaths: [] }

  const targetPathSet = new Set(targetPaths)
  const activeTargets = await listStoredDrafts(workspaceId)
    .then((entries) => entries.filter(({ path }) => targetPathSet.has(path)))
    .catch(() => [] as StoredDraftEntry[])
  let invalidationVerified = false
  try {
    await persistDraftPathInvalidation(
      workspaceId,
      newPath,
      isDirectory,
      Math.max(minimumCutoff, maximumSavedAt(activeTargets)),
    )
    invalidationVerified = true
  } catch {
    // 仍继续尝试物理删除；若删除也失败，调用方必须明确提示存在不安全残留。
  }

  const deletionResults = await Promise.allSettled(targetPaths.map((path) => deleteDraft(workspaceId, path)))
  if (invalidationVerified) return { unsafePaths: [] }

  const unsafePaths: string[] = []
  for (const [index, result] of deletionResults.entries()) {
    if (result.status === "rejected" || await loadDraft(workspaceId, targetPaths[index]).catch(() => null)) {
      unsafePaths.push(targetPaths[index])
    }
  }
  return { unsafePaths }
}

function recoveryFailureMessage(
  baseMessage: string,
  restoredDraftFailures: readonly string[],
  unsafeTargetPaths: readonly string[] = [],
): string {
  const warnings: string[] = []
  if (restoredDraftFailures.length > 0) {
    warnings.push(
      `${restoredDraftFailures.length} 个操作前草稿无法重新写入并验证（${restoredDraftFailures.join("、")}）。`
      + "本地标签和内容仍保留；请勿关闭或刷新页面，并立即复制内容，浏览器草稿恢复前不能认为数据安全。",
    )
  }
  if (unsafeTargetPaths.length > 0) {
    warnings.push(
      `新路径临时草稿无法隔离或清理（${unsafeTargetPaths.join("、")}），打开这些路径前请先清理浏览器存储。`,
    )
  }
  return warnings.length > 0 ? `${baseMessage} ${warnings.join(" ")}` : baseMessage
}

function lifecycleErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export async function deleteServerPathSafely(
  path: string,
  isDirectory: boolean,
): Promise<FileLifecycleResult> {
  const workspaceId = useEditorStore.getState().workspaceId
  if (!workspaceId) return { success: false, changed: false, message: "当前没有已绑定的编辑工作区。" }
  const matches = (candidate: string) => pathMatchesTarget(candidate, path, isDirectory)
  const release = acquireFileOperationLock(workspaceId, matches)
  let detached: DetachedEditorPaths | null = null
  let capturedDrafts: StoredDraftEntry[] = []
  let invalidationAttempted = false
  let remoteChanged = false

  try {
    if (!flushEditorInputs()) throw new Error(INPUT_FLUSH_ERROR)
    await waitForFileSaveQueues(workspaceId, matches)
    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matches)
    await persistStableAffectedDrafts(workspaceId, matches)
    capturedDrafts = await captureAffectedDrafts(workspaceId, matches)

    invalidationAttempted = true
    await persistDraftPathInvalidation(workspaceId, path, isDirectory, maximumSavedAt(capturedDrafts))
    detached = detachEditorPaths(workspaceId, matches)

    const response = await wsClient.fileDelete(path)
    if (!response.success) throw new Error("服务器拒绝删除该路径。")
    remoteChanged = true
    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matches)

    const cleanupFailures = await deleteCapturedDrafts(workspaceId, capturedDrafts)
    if (cleanupFailures.length > 0) {
      const message = `远端路径已删除，但 ${cleanupFailures.length} 个旧草稿键物理清理失败；它们已被持久化 cutoff 隔离，不会自动恢复。`
      useEditorStore.getState().setLifecycleError(message)
      return { success: true, changed: true, message }
    }

    useEditorStore.getState().setLifecycleError(null)
    return { success: true, changed: true, message: isDirectory ? "目录及其本地标签、草稿已删除。" : "文件及其本地标签、草稿已删除。" }
  } catch (error) {
    if (detached && !remoteChanged) restoreDetachedEditorPaths(detached, (candidate) => candidate)
    const restoreFailures = !remoteChanged && invalidationAttempted
      ? await restoreCapturedDrafts(workspaceId, capturedDrafts)
      : []
    const message = recoveryFailureMessage(
      lifecycleErrorMessage(error, DRAFT_PERSISTENCE_ERROR),
      restoreFailures,
    )
    useEditorStore.getState().setLifecycleError(message)
    return { success: false, changed: remoteChanged, message }
  } finally {
    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matches)
    release()
  }
}

export async function renameServerPathSafely(
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): Promise<FileLifecycleResult> {
  const workspaceId = useEditorStore.getState().workspaceId
  if (!workspaceId) return { success: false, changed: false, message: "当前没有已绑定的编辑工作区。" }
  if (oldPath === newPath) return { success: true, changed: false, message: "名称未发生变化。" }
  if (isDirectory && newPath.startsWith(`${oldPath}/`)) {
    return { success: false, changed: false, message: "不能把目录重命名到自身子目录。" }
  }

  const matchesOld = (candidate: string) => pathMatchesTarget(candidate, oldPath, isDirectory)
  const matchesNew = (candidate: string) => pathMatchesTarget(candidate, newPath, isDirectory)
  const matchesOperation = (candidate: string) => matchesOld(candidate) || matchesNew(candidate)
  const release = acquireFileOperationLock(workspaceId, matchesOperation)
  let detached: DetachedEditorPaths | null = null
  let capturedDrafts: StoredDraftEntry[] = []
  let intendedTargetPaths: string[] = []
  let migratedDrafts: StoredDraftEntry[] = []
  let invalidationAttempted = false
  let remoteChanged = false

  try {
    if (!flushEditorInputs()) throw new Error(INPUT_FLUSH_ERROR)
    await waitForFileSaveQueues(workspaceId, matchesOperation)
    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matchesOperation)
    await persistStableAffectedDrafts(workspaceId, matchesOld)
    await waitForDraftMutationsMatching(workspaceId, matchesOperation)
    capturedDrafts = await captureAffectedDrafts(workspaceId, matchesOld)
    await assertRenameTargetsAvailable(workspaceId, capturedDrafts, oldPath, newPath, isDirectory)
    intendedTargetPaths = capturedDrafts.map(({ path }) => remapTargetPath(path, oldPath, newPath, isDirectory))

    invalidationAttempted = true
    await persistDraftPathInvalidation(workspaceId, oldPath, isDirectory, maximumSavedAt(capturedDrafts))
    detached = detachEditorPaths(workspaceId, matchesOld)
    migratedDrafts = await migrateCapturedDrafts(workspaceId, capturedDrafts, oldPath, newPath, isDirectory)

    const response = await wsClient.fileRename(oldPath, newPath)
    if (!response.success) throw new Error("服务器拒绝重命名该路径。")
    remoteChanged = true

    const filesToRefresh = new Map<string, string>()
    for (const { file } of [...detached.openFiles, ...detached.recentlyClosed]) {
      filesToRefresh.set(file.path, remapTargetPath(file.path, oldPath, newPath, isDirectory))
    }
    const refreshEntries = [...filesToRefresh.entries()]
    const refreshResults = await Promise.allSettled(refreshEntries.map(async ([oldFilePath, newFilePath]) => ({
      oldFilePath,
      snapshot: await wsClient.fileRead(newFilePath),
    })))
    const serverSnapshots = new Map<string, FileReadResult | null>()
    let failedReads = 0
    for (const [index, result] of refreshResults.entries()) {
      const oldFilePath = refreshEntries[index][0]
      if (result.status === "fulfilled") serverSnapshots.set(oldFilePath, result.value.snapshot)
      else {
        failedReads += 1
        serverSnapshots.set(oldFilePath, null)
      }
    }

    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matchesOperation)
    restoreDetachedEditorPaths(
      detached,
      (candidate) => remapTargetPath(candidate, oldPath, newPath, isDirectory),
      serverSnapshots,
    )

    // 新路径草稿已在远端操作前写入并回读验证。保留该副本作为恢复锚点；
    // 后续 debounce/关闭会在锁释放后刷新 base revision，避免这里二次覆盖已验证副本。
    const cleanupFailures = await deleteCapturedDrafts(workspaceId, capturedDrafts)
    const warnings = [
      failedReads > 0 ? `${failedReads} 个标签未能读取新路径 revision，已锁定为冲突状态。` : null,
      cleanupFailures.length > 0
        ? `${cleanupFailures.length} 个旧路径草稿键物理清理失败，但已被持久化 cutoff 隔离。`
        : null,
    ].filter((warning): warning is string => warning != null)
    const message = warnings.length > 0
      ? `重命名已完成。${warnings.join(" ")}`
      : "重命名已完成，相关标签、草稿、缓存和 revision 链已迁移。"
    useEditorStore.getState().setLifecycleError(warnings.length > 0 ? message : null)
    return { success: true, changed: true, message }
  } catch (error) {
    let unsafeTargetPaths: string[] = []
    if (!remoteChanged && intendedTargetPaths.length > 0) {
      const rollback = await rollbackMigratedDrafts(
        workspaceId,
        newPath,
        isDirectory,
        intendedTargetPaths,
        maximumSavedAt(migratedDrafts),
      ).catch(() => ({ unsafePaths: intendedTargetPaths }))
      unsafeTargetPaths = rollback.unsafePaths
    }
    if (detached && !remoteChanged) restoreDetachedEditorPaths(detached, (candidate) => candidate)
    const restoreFailures = !remoteChanged && invalidationAttempted
      ? await restoreCapturedDrafts(workspaceId, capturedDrafts)
      : []
    const message = recoveryFailureMessage(
      lifecycleErrorMessage(error, DRAFT_PERSISTENCE_ERROR),
      restoreFailures,
      unsafeTargetPaths,
    )
    useEditorStore.getState().setLifecycleError(message)
    return { success: false, changed: remoteChanged, message }
  } finally {
    invalidateAcknowledgedRevisionChainsMatching(workspaceId, matchesOperation)
    release()
  }
}
