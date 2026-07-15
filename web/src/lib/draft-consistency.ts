import { deleteDraft, loadDraft, saveDraft, type StoredDraft } from "@/lib/draft-storage"
import { draftVersionOf } from "@/lib/editor-file-state"
import { isFileOperationBlocked } from "@/lib/file-operation-guard"
import type { RevisionToken } from "@/types/protocol"

export interface PersistableEditorDraft {
  path: string
  content: string
  revision: RevisionToken
  draft?: string
  dirty: boolean
  draftVersion?: number
  externalRevision?: RevisionToken
}

const generations = new Map<string, number>()
const mutationQueues = new Map<string, Promise<void>>()

function scopedDraftKey(workspaceId: string, path: string): string {
  return `${workspaceId}:${path}`
}

function currentGeneration(key: string): number {
  return generations.get(key) ?? 0
}

function nextGeneration(key: string): number {
  const generation = currentGeneration(key) + 1
  generations.set(key, generation)
  return generation
}

function enqueueDraftMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(mutation)
  const tail = result.then(() => undefined, () => undefined)
  mutationQueues.set(key, tail)
  return result.finally(() => {
    if (mutationQueues.get(key) === tail) mutationQueues.delete(key)
  })
}

export interface DraftPersistenceOptions {
  allowDuringFileOperation?: boolean
}

export async function waitForDraftMutationsMatching(
  workspaceId: string,
  matches: (path: string) => boolean,
): Promise<void> {
  const prefix = `${workspaceId}:`
  while (true) {
    const pending = [...mutationQueues.entries()]
      .filter(([key]) => key.startsWith(prefix) && matches(key.slice(prefix.length)))
      .map(([, tail]) => tail)
    if (pending.length === 0) return
    await Promise.all(pending)
    if (![...mutationQueues.keys()].some(
      (key) => key.startsWith(prefix) && matches(key.slice(prefix.length)),
    )) return
  }
}

export function canDeleteDraftSnapshot(
  draft: Pick<StoredDraft, "content"> | null,
  expectedContent: string,
  expectedGeneration: number,
  actualGeneration: number,
): boolean {
  return draft?.content === expectedContent && expectedGeneration === actualGeneration
}

export function persistDraftSnapshot(
  workspaceId: string,
  file: PersistableEditorDraft,
  options: DraftPersistenceOptions = {},
): Promise<void> {
  if (!file.dirty || file.draft == null) return Promise.resolve()
  if (!options.allowDuringFileOperation && isFileOperationBlocked(workspaceId, file.path)) return Promise.resolve()

  const key = scopedDraftKey(workspaceId, file.path)
  nextGeneration(key)
  const snapshot = {
    content: file.draft,
    baseContent: file.content,
    baseRevision: file.revision,
    draftVersion: draftVersionOf(file),
    requiresConflictResolution: file.externalRevision != null,
  }

  return enqueueDraftMutation(key, async () => {
    await saveDraft(workspaceId, file.path, snapshot)
  })
}

/** 正常生命周期路径必须 await 此 Promise，全部写入成功后才能关闭或切换 workspace。 */
export async function persistDraftSnapshots(
  workspaceId: string | null,
  files: readonly PersistableEditorDraft[],
  options: DraftPersistenceOptions = {},
): Promise<void> {
  if (!workspaceId) return
  await Promise.all(
    files
      .filter((file) => file.dirty && file.draft != null)
      .map((file) => persistDraftSnapshot(workspaceId, file, options)),
  )
}

/** beforeunload/React 卸载无法等待 IndexedDB，仅明确执行 best-effort 并记录失败。 */
export function persistDraftSnapshotsBestEffort(
  workspaceId: string | null,
  files: readonly PersistableEditorDraft[],
): void {
  void persistDraftSnapshots(workspaceId, files).catch((error) => {
    console.error("草稿 best-effort 持久化失败:", error)
  })
}

export function deleteDraftSnapshotIfUnchanged(
  workspaceId: string,
  path: string,
  expectedContent: string,
): Promise<boolean> {
  const key = scopedDraftKey(workspaceId, path)
  const generation = currentGeneration(key)

  return enqueueDraftMutation(key, async () => {
    if (currentGeneration(key) !== generation) return false
    const draft = await loadDraft(workspaceId, path)
    if (!canDeleteDraftSnapshot(draft, expectedContent, generation, currentGeneration(key))) return false
    await deleteDraft(workspaceId, path)
    return true
  })
}
