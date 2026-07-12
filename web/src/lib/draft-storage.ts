import { get, set, del, keys } from "idb-keyval"
import { useConnectionStore } from "@/store/connection-store"

const DRAFT_PREFIX = "draft:v2:"

function currentWorkspaceId(): string {
  return useConnectionStore.getState().workspaceId ?? "unbound"
}

function draftPrefix(workspaceId = currentWorkspaceId()): string {
  return `${DRAFT_PREFIX}${workspaceId}:`
}

function draftKey(path: string, workspaceId = currentWorkspaceId()): string {
  return `${draftPrefix(workspaceId)}${path}`
}

export async function saveDraft(path: string, content: string, workspaceId = currentWorkspaceId()) {
  await set(draftKey(path, workspaceId), {
    content,
    savedAt: Date.now(),
    workspaceId,
  })
}

export async function loadDraft(path: string, workspaceId = currentWorkspaceId()): Promise<{ content: string; savedAt: number } | null> {
  return await get(draftKey(path, workspaceId)) ?? null
}

export async function deleteDraft(path: string, workspaceId = currentWorkspaceId()) {
  await del(draftKey(path, workspaceId))
}

export async function listDrafts(workspaceId = currentWorkspaceId()): Promise<string[]> {
  const prefix = draftPrefix(workspaceId)
  const allKeys = await keys()
  return (allKeys as string[])
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

export async function clearAllDrafts(workspaceId = currentWorkspaceId()) {
  const prefix = draftPrefix(workspaceId)
  const allKeys = await keys()
  for (const key of allKeys) {
    if ((key as string).startsWith(prefix)) await del(key)
  }
}
