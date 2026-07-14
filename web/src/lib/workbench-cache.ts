import { get, set } from "idb-keyval"

const CACHE_PREFIX = "workbench:v1"

export interface WorkbenchCacheScope {
  accountId: string
  workspaceId: string
  serverInstanceId: string
  draftId: string
  versionId: string
  path: string
}

export interface CachedServerValue<T> {
  value: T
  cachedAt: number
  source: "server"
}

const segment = (value: string) => encodeURIComponent(value || "unbound")

export function workbenchCacheKey(scope: WorkbenchCacheScope): string {
  return [
    CACHE_PREFIX,
    segment(scope.accountId),
    segment(scope.workspaceId),
    segment(scope.serverInstanceId),
    segment(scope.draftId),
    segment(scope.versionId),
    segment(scope.path),
  ].join(":")
}

export function promptCacheKey(accountId: string, workspaceId: string, serverInstanceId: string): string {
  return workbenchCacheKey({
    accountId,
    workspaceId,
    serverInstanceId,
    draftId: "prompt",
    versionId: "latest",
    path: "prompt.txt",
  })
}

export async function cacheServerValue<T>(scope: WorkbenchCacheScope, value: T): Promise<void> {
  const entry: CachedServerValue<T> = { value, cachedAt: Date.now(), source: "server" }
  await set(workbenchCacheKey(scope), entry)
}

export async function readCachedServerValue<T>(scope: WorkbenchCacheScope): Promise<CachedServerValue<T> | null> {
  return await get<CachedServerValue<T>>(workbenchCacheKey(scope)) ?? null
}

export async function cacheRecentPrompt(accountId: string, workspaceId: string, serverInstanceId: string, prompt: string): Promise<void> {
  await set(promptCacheKey(accountId, workspaceId, serverInstanceId), { value: prompt, cachedAt: Date.now(), source: "local-prompt" })
}

export async function readRecentPrompt(accountId: string, workspaceId: string, serverInstanceId: string): Promise<string> {
  const entry = await get<{ value?: unknown }>(promptCacheKey(accountId, workspaceId, serverInstanceId))
  return typeof entry?.value === "string" ? entry.value : ""
}
