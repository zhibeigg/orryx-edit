import { create } from "zustand"
import type { CollaboratorPresence, AuthSession } from "@/lib/ws-client"

interface ConnectionState {
  connected: boolean
  authenticated: boolean
  reconnecting: boolean
  workspaceId: string | null
  browserId: string | null
  playerName: string | null
  serverName: string | null
  onlineCount: number
  collaborators: CollaboratorPresence[]
  error: string | null

  setConnected: (connected: boolean) => void
  setAuthenticated: (authenticated: boolean, session?: AuthSession) => void
  setReconnecting: (reconnecting: boolean) => void
  setCollaborators: (collaborators: CollaboratorPresence[]) => void
  setError: (error: string | null) => void
  reset: () => void
}

const disconnectedState = {
  connected: false,
  authenticated: false,
  reconnecting: false,
  workspaceId: null,
  browserId: null,
  playerName: null,
  serverName: null,
  onlineCount: 0,
  collaborators: [] as CollaboratorPresence[],
  error: null,
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  ...disconnectedState,

  setConnected: (connected) => {
    if (connected) {
      set({ connected: true, reconnecting: false, error: null })
      return
    }
    const { authenticated } = get()
    set({ connected: false, reconnecting: authenticated, error: "连接已断开" })
  },

  setAuthenticated: (authenticated, session) => {
    if (!authenticated) {
      set({
        authenticated: false,
        reconnecting: false,
        workspaceId: null,
        browserId: null,
        playerName: null,
        serverName: null,
        onlineCount: 0,
        collaborators: [],
      })
      return
    }
    set({
      authenticated: true,
      reconnecting: false,
      workspaceId: session?.workspaceId ?? get().workspaceId,
      browserId: session?.browserId ?? get().browserId,
      playerName: session?.playerName ?? get().playerName,
      serverName: session?.serverName ?? get().serverName,
      onlineCount: session?.onlineCount ?? get().onlineCount,
      collaborators: session?.collaborators ?? get().collaborators,
      error: null,
    })
  },

  setReconnecting: (reconnecting) => set({ reconnecting }),
  setCollaborators: (collaborators) => set({ collaborators }),
  setError: (error) => set({ error }),
  reset: () => set({ ...disconnectedState, collaborators: [] }),
}))
