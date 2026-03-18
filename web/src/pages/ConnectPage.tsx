import { useState, useEffect, useRef, useCallback } from "react"
import { useConnectionStore } from "@/store/connection-store"
import { useFileStore } from "@/store/file-store"
import { wsClient } from "@/lib/ws-client"

export function ConnectPage() {
  const { setConnected, setAuthenticated, setToken, setError, error } = useConnectionStore()
  const { setFileTree, setLoading } = useFileStore()
  const [tokenInput, setTokenInput] = useState("")
  const [connecting, setConnecting] = useState(false)
  const autoConnectTriggered = useRef(false)

  const handleConnect = useCallback(async (token?: string) => {
    const t = token ?? tokenInput
    if (!t.trim()) return
    setConnecting(true)
    setError(null)

    try {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`

      wsClient.setStatusChangeHandler((connected) => {
        setConnected(connected)
      })

      wsClient.setReconnectedHandler((serverName) => {
        setAuthenticated(true, serverName)
      })

      wsClient.setReconnectFailedHandler(() => {
        useConnectionStore.getState().setReconnecting(false)
        setError("重连失败，请刷新页面重试")
      })

      await wsClient.connect(wsUrl)
      setConnected(true)
      setToken(t)

      const authResult = await wsClient.auth(t)
      if (!authResult.success) {
        setError("认证失败：Token 无效或已过期")
        wsClient.disconnect()
        return
      }

      setAuthenticated(true, authResult.serverName)

      // 清除 URL 中的 token 参数（安全考虑）
      const url = new URL(window.location.href)
      if (url.searchParams.has("token")) {
        url.searchParams.delete("token")
        window.history.replaceState({}, "", url.toString())
      }

      setLoading(true)
      const fileResult = await wsClient.fileList()
      setFileTree(fileResult.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败")
    } finally {
      setConnecting(false)
    }
  }, [tokenInput, setConnected, setAuthenticated, setToken, setError, setLoading, setFileTree])

  // URL 带 token 时自动连接
  useEffect(() => {
    if (autoConnectTriggered.current) return
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get("token")
    if (urlToken) {
      autoConnectTriggered.current = true
      setTokenInput(urlToken)
      handleConnect(urlToken)
    }
  }, [handleConnect])

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Orryx Editor</h1>
          <p className="text-muted-foreground">输入 Token 连接到游戏服务器</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="输入一次性 Token..."
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={connecting}
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            onClick={() => handleConnect()}
            disabled={connecting || !tokenInput.trim()}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {connecting ? "连接中..." : "连接"}
          </button>
        </div>
      </div>
    </div>
  )
}
