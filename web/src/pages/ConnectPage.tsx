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
    <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
      <div className="w-full max-w-sm p-6 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-medium text-[#cccccc]">Orryx Editor</h1>
          <p className="text-[13px] text-[#858585]">输入 Token 连接到游戏服务器</p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="输入一次性 Token..."
            className="w-full px-3 py-2 bg-[#3c3c3c] border border-[#3c3c3c] text-[#cccccc] placeholder:text-[#858585] focus:outline-none focus:border-[#007acc] text-[13px]"
            disabled={connecting}
          />

          {error && (
            <p className="text-[13px] text-[#f44747]">{error}</p>
          )}

          <button
            onClick={() => handleConnect()}
            disabled={connecting || !tokenInput.trim()}
            className="w-full py-2 bg-[#007acc] text-white text-[13px] font-medium hover:bg-[#0098ff] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {connecting ? "连接中..." : "连接"}
          </button>
        </div>
      </div>
    </div>
  )
}
