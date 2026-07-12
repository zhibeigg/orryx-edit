import { deleteDraft } from "@/lib/draft-storage"
import { wsClient, WsRequestError } from "@/lib/ws-client"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

export async function saveEditorFile(file: OpenFile, content: string, force = false): Promise<boolean> {
  try {
    const result = await wsClient.fileWrite(file.path, content, file.revision, force)
    if (!result.success) return false
    useEditorStore.getState().markSaved(file.path, content, result.revision)
    await deleteDraft(file.path)
    return true
  } catch (error) {
    if (error instanceof WsRequestError && error.code === "REVISION_CONFLICT") {
      useEditorStore.getState().setSaveConflict({
        path: file.path,
        attemptedContent: content,
        currentRevision: error.data.currentRevision ?? file.revision,
      })
      return false
    }
    throw error
  }
}
