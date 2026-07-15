import { get, set, del, keys } from "idb-keyval"
import type { RevisionToken } from "@/types/protocol"

const DRAFT_PREFIX = "draft:v2:"
const INVALIDATION_PREFIX = "draft-invalidation:v1:"

export interface StoredDraft {
  content: string
  savedAt: number
  workspaceId: string
  baseContent?: string
  baseRevision?: RevisionToken
  draftVersion?: number
  requiresConflictResolution?: boolean
}

export interface DraftPathInvalidation {
  workspaceId: string
  path: string
  isDirectory: boolean
  cutoff: number
}

export interface StoredDraftEntry {
  path: string
  draft: StoredDraft
}

function draftPrefix(workspaceId: string): string {
  return `${DRAFT_PREFIX}${workspaceId}:`
}

function draftKey(path: string, workspaceId: string): string {
  return `${draftPrefix(workspaceId)}${path}`
}

function invalidationPrefix(workspaceId: string): string {
  return `${INVALIDATION_PREFIX}${workspaceId}:`
}

function invalidationKey(workspaceId: string, path: string, isDirectory: boolean): string {
  return `${invalidationPrefix(workspaceId)}${isDirectory ? "directory" : "file"}:${encodeURIComponent(path)}`
}

function pathMatchesInvalidation(path: string, invalidation: DraftPathInvalidation): boolean {
  return path === invalidation.path
    || (invalidation.isDirectory && path.startsWith(`${invalidation.path}/`))
}

function effectiveInvalidationCutoff(path: string, invalidations: readonly DraftPathInvalidation[]): number {
  return invalidations.reduce(
    (cutoff, invalidation) => pathMatchesInvalidation(path, invalidation) ? Math.max(cutoff, invalidation.cutoff) : cutoff,
    0,
  )
}

async function readInvalidations(workspaceId: string, allKeys?: readonly IDBValidKey[]): Promise<DraftPathInvalidation[]> {
  const prefix = invalidationPrefix(workspaceId)
  const invalidationKeys = (allKeys ?? await keys()).filter(
    (key): key is string => typeof key === "string" && key.startsWith(prefix),
  )
  const values = await Promise.all(invalidationKeys.map((key) => get<DraftPathInvalidation>(key)))
  return values.filter((value): value is DraftPathInvalidation =>
    value != null
    && value.workspaceId === workspaceId
    && typeof value.path === "string"
    && typeof value.isDirectory === "boolean"
    && Number.isFinite(value.cutoff),
  )
}

async function readStoredDraft(workspaceId: string, path: string): Promise<StoredDraft | null> {
  return await get<StoredDraft>(draftKey(path, workspaceId)) ?? null
}

export async function getDraftInvalidationCutoff(workspaceId: string, path: string): Promise<number> {
  return effectiveInvalidationCutoff(path, await readInvalidations(workspaceId))
}

/**
 * 在远端破坏操作前持久化路径失效边界，并回读验证。目录边界会覆盖全部子路径。
 * cutoff 不会倒退，且调用方可传入已捕获草稿的最大 savedAt，确保这些草稿立即失效。
 */
export async function persistDraftPathInvalidation(
  workspaceId: string,
  path: string,
  isDirectory: boolean,
  minimumCutoff = 0,
): Promise<DraftPathInvalidation> {
  const key = invalidationKey(workspaceId, path, isDirectory)
  const previous = await get<DraftPathInvalidation>(key)
  const invalidation: DraftPathInvalidation = {
    workspaceId,
    path,
    isDirectory,
    cutoff: Math.max(Date.now(), minimumCutoff, previous?.cutoff ?? 0),
  }
  await set(key, invalidation)
  const verified = await get<DraftPathInvalidation>(key)
  if (!verified
    || verified.workspaceId !== invalidation.workspaceId
    || verified.path !== invalidation.path
    || verified.isDirectory !== invalidation.isDirectory
    || verified.cutoff !== invalidation.cutoff) {
    throw new Error(`无法验证路径 ${path} 的草稿失效标记。`)
  }
  return invalidation
}

/** 保存草稿时始终生成晚于现有失效边界和旧记录的 savedAt。 */
export async function saveDraft(
  workspaceId: string,
  path: string,
  draft: Omit<StoredDraft, "savedAt" | "workspaceId">,
): Promise<StoredDraft> {
  const [cutoff, previous] = await Promise.all([
    getDraftInvalidationCutoff(workspaceId, path),
    readStoredDraft(workspaceId, path),
  ])
  const stored = {
    ...draft,
    savedAt: Math.max(Date.now(), cutoff + 1, (previous?.savedAt ?? 0) + 1),
    workspaceId,
  } satisfies StoredDraft
  await set(draftKey(path, workspaceId), stored)

  // 若另一个上下文在写入期间推进了 cutoff，该记录保持物理存在但必须继续被隔离。
  const latestCutoff = await getDraftInvalidationCutoff(workspaceId, path)
  if (stored.savedAt <= latestCutoff) {
    throw new Error(`路径 ${path} 在草稿写入期间已失效。`)
  }
  return stored
}

export async function loadDraft(workspaceId: string, path: string): Promise<StoredDraft | null> {
  const [draft, cutoff] = await Promise.all([
    readStoredDraft(workspaceId, path),
    getDraftInvalidationCutoff(workspaceId, path),
  ])
  return draft && draft.workspaceId === workspaceId && draft.savedAt > cutoff ? draft : null
}

export async function deleteDraft(workspaceId: string, path: string) {
  await del(draftKey(path, workspaceId))
}

export async function listStoredDrafts(workspaceId: string): Promise<StoredDraftEntry[]> {
  const prefix = draftPrefix(workspaceId)
  const allKeys = await keys()
  const invalidations = await readInvalidations(workspaceId, allKeys)
  const draftKeys = allKeys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(prefix),
  )
  const entries = await Promise.all(draftKeys.map(async (key): Promise<StoredDraftEntry | null> => {
    const path = key.slice(prefix.length)
    const draft = await get<StoredDraft>(key)
    if (!draft || draft.workspaceId !== workspaceId || draft.savedAt <= effectiveInvalidationCutoff(path, invalidations)) {
      return null
    }
    return { path, draft }
  }))
  return entries.filter((entry): entry is StoredDraftEntry => entry != null)
}

export async function listDrafts(workspaceId: string): Promise<string[]> {
  return (await listStoredDrafts(workspaceId)).map(({ path }) => path)
}

export async function clearAllDrafts(workspaceId: string) {
  const allKeys = await keys()
  const draftsPrefix = draftPrefix(workspaceId)
  const invalidationsPrefix = invalidationPrefix(workspaceId)
  const draftKeys = allKeys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(draftsPrefix),
  )
  const invalidationKeys = allKeys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(invalidationsPrefix),
  )

  // 仅在全部草稿物理删除成功后移除 tombstone，避免失败时重新激活旧草稿。
  await Promise.all(draftKeys.map((key) => del(key)))
  await Promise.all(invalidationKeys.map((key) => del(key)))
}
