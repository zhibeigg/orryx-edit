import { useEffect } from "react"
import { wsClient, type CollaboratorPresence } from "@/lib/ws-client"
import { MSG, type WsMessage } from "@/types"
import { useConnectionStore } from "@/store/connection-store"
import { useEditorStore } from "@/store/editor-store"

export function useCollaboration() {
  const activeFilePath = useEditorStore((state) => state.activeFilePath)

  useEffect(() => {
    const unsubscribePresence = wsClient.on(MSG.PRESENCE_UPDATED, (message: WsMessage) => {
      const data = message.data as { members?: CollaboratorPresence[] }
      useConnectionStore.getState().setCollaborators(data.members ?? [])
    })
    const unsubscribeFileChanged = wsClient.on(MSG.FILE_CHANGED, (message: WsMessage) => {
      const data = message.data as { path?: string; revision?: number; browserId?: string }
      const ownBrowserId = useConnectionStore.getState().browserId
      if (!data.path || typeof data.revision !== "number" || data.browserId === ownBrowserId) return
      useEditorStore.getState().markExternalChange(data.path, data.revision)
    })
    return () => {
      unsubscribePresence()
      unsubscribeFileChanged()
    }
  }, [])

  useEffect(() => {
    wsClient.updatePresence(activeFilePath)
  }, [activeFilePath])
}
