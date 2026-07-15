import { useEffect } from "react"
import { clearAcknowledgedRevisionChainsForWorkspace } from "@/lib/acknowledged-revision-chain"
import { resynchronizeOpenFiles } from "@/lib/server-file"
import { wsClient, type CollaboratorPresence, type RelayServerInfo } from "@/lib/ws-client"
import { MSG, type WsMessage } from "@/types"
import type { RevisionToken } from "@/types/protocol"
import { useConnectionStore } from "@/store/connection-store"
import { useEditorStore } from "@/store/editor-store"

function parseRelayServerInfo(data: unknown): RelayServerInfo | null {
  if (!data || typeof data !== "object") return null
  const candidate = data as Partial<RelayServerInfo>
  if (
    typeof candidate.online !== "boolean"
    || typeof candidate.workspaceId !== "string"
    || typeof candidate.serverId !== "string"
    || (candidate.negotiatedProtocol !== "v1" && candidate.negotiatedProtocol !== "v2")
    || typeof candidate.sessionEpoch !== "number"
    || !Number.isSafeInteger(candidate.sessionEpoch)
    || !Array.isArray(candidate.relayCapabilities)
    || candidate.relayCapabilities.some((capability) => typeof capability !== "string")
  ) {
    return null
  }
  return candidate as RelayServerInfo
}

function markWorkspaceRevisionsUnverified(workspaceId: string) {
  clearAcknowledgedRevisionChainsForWorkspace(workspaceId)
  const editor = useEditorStore.getState()
  editor.openFiles
    .filter((file) => file.workspaceId === workspaceId)
    .forEach((file) => editor.markRevisionUnverified(workspaceId, file.path))
}

export async function applyRelayServerInfo(data: unknown): Promise<boolean> {
  const info = parseRelayServerInfo(data)
  if (!info) return false
  const connection = useConnectionStore.getState()
  if (connection.workspaceId !== info.workspaceId || !connection.setServerInfo(info)) return false

  markWorkspaceRevisionsUnverified(info.workspaceId)
  if (!info.online) return true
  await resynchronizeOpenFiles(info.workspaceId)
  return true
}

export function useCollaboration() {
  const activeFilePath = useEditorStore((state) => state.activeFilePath)

  useEffect(() => {
    const unsubscribePresence = wsClient.on(MSG.PRESENCE_UPDATED, (message: WsMessage) => {
      const data = message.data as { members?: CollaboratorPresence[] }
      useConnectionStore.getState().setCollaborators(data.members ?? [])
    })
    const unsubscribeFileChanged = wsClient.on(MSG.FILE_CHANGED, (message: WsMessage) => {
      const data = message.data as { path?: string; revision?: RevisionToken; browserId?: string }
      const connection = useConnectionStore.getState()
      if (!connection.workspaceId || !data.path || (typeof data.revision !== "number" && typeof data.revision !== "string") || data.browserId === connection.browserId) return
      useEditorStore.getState().markExternalChange(connection.workspaceId, data.path, data.revision)
    })
    const unsubscribeServerInfo = wsClient.on(MSG.SERVER_INFO, (message: WsMessage) => {
      void applyRelayServerInfo(message.data).catch((error) => {
        useConnectionStore.getState().setError(error instanceof Error ? error.message : "插件重新注册后刷新文件失败")
      })
    })
    return () => {
      unsubscribePresence()
      unsubscribeFileChanged()
      unsubscribeServerInfo()
    }
  }, [])

  useEffect(() => {
    wsClient.updatePresence(activeFilePath)
  }, [activeFilePath])
}
