import { useCallback, useState } from "react"
import { apiRequest } from "@/lib/api-client"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

export type CloudDraftStatus = "OPEN" | "ARCHIVED" | string
export type CloudDraftVersionSource = "MANUAL" | "AI" | "IMPORT"

export interface CloudDraft {
  id: string
  accountId?: string
  serverInstanceId: string
  baseSnapshotId: string
  title: string
  status: CloudDraftStatus
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface CreateCloudDraftInput {
  serverInstanceId: string
  baseSnapshotId: string
  title: string
}

export interface CloudDraftFileChange {
  changeType: "UPSERT" | "DELETE"
  path: string
  baseRevision?: string | null
  content?: string | null
}

export interface AppendCloudDraftVersionInput {
  expectedCurrentVersion: number
  source: CloudDraftVersionSource
  files: CloudDraftFileChange[]
}

export interface CloudDraftVersion {
  id: string
  draftId: string
  versionNumber: number
  source: CloudDraftVersionSource
  manifestRevision?: string
  createdAt: string
  files?: CloudDraftFileChange[]
}

export type CloudDraftListResponse = CloudDraft[] | { drafts: CloudDraft[] }

export const cloudDraftApi = {
  list(serverInstanceId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ serverInstanceId })
    return apiRequest<CloudDraftListResponse>(`/api/v2/drafts?${query.toString()}`, { signal })
  },
  create(input: CreateCloudDraftInput, signal?: AbortSignal) {
    return apiRequest<CloudDraft, CreateCloudDraftInput>("/api/v2/drafts", { method: "POST", body: input, signal })
  },
  get(id: string, signal?: AbortSignal) {
    return apiRequest<CloudDraft>(`/api/v2/drafts/${encodeURIComponent(id)}`, { signal })
  },
  appendVersion(id: string, input: AppendCloudDraftVersionInput, signal?: AbortSignal) {
    return apiRequest<CloudDraftVersion, AppendCloudDraftVersionInput>(`/api/v2/drafts/${encodeURIComponent(id)}/versions`, {
      method: "POST",
      body: input,
      signal,
    })
  },
}

export function resolveCloudDrafts(response: CloudDraftListResponse): CloudDraft[] {
  return Array.isArray(response) ? response : response.drafts
}

export function currentFileVersionInput(file: OpenFile, expectedCurrentVersion: number): AppendCloudDraftVersionInput {
  return {
    expectedCurrentVersion,
    source: "MANUAL",
    files: [{
      changeType: "UPSERT",
      path: file.path,
      baseRevision: String(file.revision),
      content: file.draft ?? file.content,
    }],
  }
}

export function saveCurrentFileToCloudDraftVersion(
  draftId: string,
  expectedCurrentVersion: number,
  file: OpenFile,
  signal?: AbortSignal,
) {
  return cloudDraftApi.appendVersion(draftId, currentFileVersionInput(file, expectedCurrentVersion), signal)
}

export function saveActiveFileToCloudDraftVersion(draftId: string, expectedCurrentVersion: number, signal?: AbortSignal) {
  const state = useEditorStore.getState()
  const file = state.openFiles.find((candidate) => candidate.path === state.activeFilePath)
  if (!file) throw new Error("当前没有打开的文件。")
  return saveCurrentFileToCloudDraftVersion(draftId, expectedCurrentVersion, file, signal)
}

export function useCloudDraftVersionSave() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const saveCurrentFile = useCallback(async (draftId: string, expectedCurrentVersion: number) => {
    setSaving(true)
    setError(null)
    try {
      return await saveActiveFileToCloudDraftVersion(draftId, expectedCurrentVersion)
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("云端草稿保存失败。")
      setError(nextError)
      throw nextError
    } finally {
      setSaving(false)
    }
  }, [])

  return { saveCurrentFile, saving, error }
}
