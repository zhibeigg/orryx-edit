import type { RevisionToken } from "@/types/protocol"

export interface EditorFileSnapshotState {
  content: string
  revision: RevisionToken
  externalRevision?: RevisionToken
  draft?: string
  dirty: boolean
  draftVersion?: number
}

export function draftVersionOf(file: Pick<EditorFileSnapshotState, "draftVersion">): number {
  return file.draftVersion ?? 0
}

export function displayedContentOf(file: Pick<EditorFileSnapshotState, "content" | "draft">): string {
  return file.draft ?? file.content
}

export function updateFileDraft<T extends EditorFileSnapshotState>(file: T, draft: string): T {
  const dirty = draft !== file.content
  return {
    ...file,
    draft: dirty ? draft : undefined,
    dirty,
    draftVersion: draftVersionOf(file) + 1,
  }
}

export function applyAcknowledgedSnapshot<T extends EditorFileSnapshotState>(
  file: T,
  content: string,
  revision: RevisionToken,
  acknowledgedDraftVersion: number,
): T {
  const currentDraftVersion = draftVersionOf(file)
  const draftAfterRequest = currentDraftVersion !== acknowledgedDraftVersion
    ? displayedContentOf(file)
    : undefined
  const dirty = draftAfterRequest != null && draftAfterRequest !== content

  return {
    ...file,
    content,
    revision,
    externalRevision: file.externalRevision != null && file.externalRevision !== revision
      ? file.externalRevision
      : undefined,
    draft: dirty ? draftAfterRequest : undefined,
    dirty,
    draftVersion: currentDraftVersion,
  }
}

export function reconcileServerSnapshot<T extends EditorFileSnapshotState>(
  file: T,
  content: string,
  revision: RevisionToken,
  requireDirtyConflict: boolean,
): T {
  const draft = displayedContentOf(file)
  if (!file.dirty || draft === content) {
    return {
      ...file,
      content,
      revision,
      externalRevision: undefined,
      draft: undefined,
      dirty: false,
    }
  }

  const hasChangedBase = file.content !== content || file.externalRevision != null
  return {
    ...file,
    content,
    revision,
    externalRevision: requireDirtyConflict || hasChangedBase ? revision : undefined,
    draft,
    dirty: true,
  }
}

export function hasExternalRevision(
  currentRevision: RevisionToken,
  incomingRevision: RevisionToken,
): boolean {
  return incomingRevision !== currentRevision
}

export function canCloseAfterSaving(
  allSucceeded: boolean,
  files: ReadonlyArray<Pick<EditorFileSnapshotState, "dirty">>,
): boolean {
  return allSucceeded && !files.some((file) => file.dirty)
}
