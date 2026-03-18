import { create } from "zustand"

interface ConnectionState {
  connected: boolean
  authenticated: boolean
  reconnecting: boolean
  token: string | null
  serverName: string | null
  error: string | null

  setConnected: (connected: boolean) => void
  setAuthenticated: (authenticated: boolean, serverName?: string) => void
  setReconnecting: (reconnecting: boolean) => void
  setToken: (token: string | null) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connected: false,
  authenticated: false,
  reconnecting: false,
  token: null,
  serverName: null,
  error: null,

  setConnected: (connected) => {
    if (connected) {
      set({ connected, reconnecting: false, error: null })
    } else {
      // 断线时保留 authenticated（允许离线查看草稿），标记重连中
      const { authenticated } = get()
      set({
        connected,
        reconnecting: authenticated, // 只有之前已认证才尝试重连
        error: "连接已断开",
      })
    }
  },
  setAuthenticated: (authenticated, serverName) => set({ authenticated, serverName: serverName ?? null, reconnecting: false }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setToken: (token) => set({ token }),
  setError: (error) => set({ error }),
  reset: () => set({ connected: false, authenticated: false, reconnecting: false, token: null, serverName: null, error: null }),
}))
