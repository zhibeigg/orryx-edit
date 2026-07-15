import { create } from "zustand"
import type { CollaboratorPresence, AuthSession, RelayServerInfo, NegotiatedProtocol } from "@/lib/ws-client"
import { useEditorStore } from "@/store/editor-store"
import { useFileStore } from "@/store/file-store"

interface ConnectionState {
  connected: boolean
  authenticated: boolean
  reconnecting: boolean
  workspaceId: string | null
  browserId: string | null
  playerName: string | null
  serverName: string | null
  serverId: string | null
  serverOnline: boolean
  negotiatedProtocol: NegotiatedProtocol | null
  sessionEpoch: number | null
  relayCapabilities: string[]
  onlineCount: number
  collaborators: CollaboratorPresence[]
  error: string | null

  setConnected: (connected: boolean) => void
  setAuthenticated: (authenticated: boolean, session?: AuthSession) => Promise<boolean>
  setServerInfo: (info: RelayServerInfo) => boolean
  setReconnecting: (reconnecting: boolean) => void
  setCollaborators: (collaborators: CollaboratorPresence[]) => void
  setError: (error: string | null) => void
  reset: () => Promise<boolean>
}

const disconnectedState = {
  connected: false,
  authenticated: false,
  reconnecting: false,
  workspaceId: null,
  browserId: null,
  playerName: null,
  serverName: null,
  serverId: null,
  serverOnline: false,
  negotiatedProtocol: null as NegotiatedProtocol | null,
  sessionEpoch: null,
  relayCapabilities: [] as string[],
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

  setAuthenticated: async (authenticated, session) => {
    if (!authenticated) {
      if (!await useEditorStore.getState().setWorkspace(null)) {
        set({
          connected: false,
          authenticated: false,
          reconnecting: false,
          serverOnline: false,
          error: "编辑会话已结束，但草稿持久化失败；工作区已保留，请处理浏览器存储问题后重试。",
        })
        return false
      }
      useFileStore.getState().reset()
      set({
        connected: false,
        authenticated: false,
        reconnecting: false,
        workspaceId: null,
        browserId: null,
        playerName: null,
        serverName: null,
        serverId: null,
        serverOnline: false,
        negotiatedProtocol: null,
        sessionEpoch: null,
        relayCapabilities: [],
        onlineCount: 0,
        collaborators: [],
      })
      return true
    }

    const workspaceId = session?.workspaceId ?? get().workspaceId
    if (!workspaceId) {
      if (!await useEditorStore.getState().setWorkspace(null)) {
        set({ error: "认证响应无效，且当前草稿持久化失败；已保留现有工作区。" })
        return false
      }
      useFileStore.getState().reset()
      set({
        authenticated: false,
        reconnecting: false,
        workspaceId: null,
        serverId: null,
        serverOnline: false,
        negotiatedProtocol: null,
        sessionEpoch: null,
        relayCapabilities: [],
        error: "认证响应缺少 workspaceId",
      })
      return false
    }

    if (!await useEditorStore.getState().setWorkspace(workspaceId)) {
      set({ error: "切换工作区前无法确认草稿持久化；已保留原工作区，请处理浏览器存储问题后重试。" })
      return false
    }
    set({
      authenticated: true,
      reconnecting: false,
      workspaceId,
      browserId: session?.browserId ?? get().browserId,
      playerName: session?.playerName ?? get().playerName,
      serverName: session?.serverName ?? get().serverName,
      serverId: session?.serverId ?? get().serverId,
      serverOnline: true,
      negotiatedProtocol: session?.negotiatedProtocol ?? get().negotiatedProtocol,
      sessionEpoch: session?.sessionEpoch ?? get().sessionEpoch,
      relayCapabilities: session?.relayCapabilities ?? get().relayCapabilities,
      onlineCount: session?.onlineCount ?? get().onlineCount,
      collaborators: session?.collaborators ?? get().collaborators,
      error: null,
    })
    return true
  },

  setServerInfo: (info) => {
    if (get().workspaceId !== info.workspaceId) return false
    set({
      serverOnline: info.online,
      serverId: info.serverId,
      serverName: info.serverName ?? get().serverName,
      negotiatedProtocol: info.negotiatedProtocol,
      sessionEpoch: info.sessionEpoch,
      relayCapabilities: info.relayCapabilities,
      error: info.online ? null : get().error,
    })
    return true
  },

  setReconnecting: (reconnecting) => set({ reconnecting }),
  setCollaborators: (collaborators) => set({ collaborators }),
  setError: (error) => set({ error }),
  reset: async () => {
    if (!await useEditorStore.getState().setWorkspace(null)) {
      set({ error: "断开前无法确认草稿持久化；已保留当前工作区。" })
      return false
    }
    useFileStore.getState().reset()
    set({ ...disconnectedState, collaborators: [] })
    return true
  },
}))
