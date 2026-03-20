import { useState, useEffect, useRef, useCallback } from "react"
import { useConnectionStore } from "@/store/connection-store"
import { useFileStore } from "@/store/file-store"
import { wsClient } from "@/lib/ws-client"
import { KeyRound, Unlink, Check, AlertCircle } from "lucide-react"

export function ConnectPage() {
  const { setConnected, setAuthenticated, setToken, setError, error } = useConnectionStore()
  const { setFileTree, setLoading } = useFileStore()
  const [tokenInput, setTokenInput] = useState("")
  const [connecting, setConnecting] = useState(false)
  const autoConnectTriggered = useRef(false)

  // 解绑 IP 状态
  const [showUnbind, setShowUnbind] = useState(false)
  const [unbindKey, setUnbindKey] = useState("")
  const [unbindStatus, setUnbindStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [unbinding, setUnbinding] = useState(false)

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

      wsClient.setReconnectedHandler((serverName, onlineCount) => {
        setAuthenticated(true, serverName, onlineCount)
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

      setAuthenticated(true, authResult.serverName, authResult.onlineCount)

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

  const handleUnbind = async () => {
    if (!unbindKey.trim()) return
    setUnbinding(true)
    setUnbindStatus(null)
    try {
      const res = await fetch("/api/license/ip", {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${unbindKey.trim()}` },
      })
      if (res.ok) {
        setUnbindStatus({ type: "success", msg: "IP 已解绑，下次插件连接时将自动绑定新 IP" })
        setUnbindKey("")
      } else {
        const text = await res.text()
        setUnbindStatus({ type: "error", msg: text || "解绑失败，请检查 License Key" })
      }
    } catch {
      setUnbindStatus({ type: "error", msg: "网络错误" })
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
      <div className="card-elevated w-full max-w-sm p-6 space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-headline-small text-[#cccccc]">Orryx Editor</h1>
          <p className="text-body-small text-[#858585]">输入 Token 连接到游戏服务器</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-label-small text-[#858585]">Token</label>
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="输入一次性 Token..."
              className="input-filled w-full text-[13px]"
              disabled={connecting}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-[13px] text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={() => handleConnect()}
            disabled={connecting || !tokenInput.trim()}
            className="btn btn-filled w-full"
          >
            {connecting ? "连接中..." : "连接"}
          </button>
        </div>

        <div className="border-t border-[#3c3c3c] pt-4">
          <button
            onClick={() => { setShowUnbind(!showUnbind); setUnbindStatus(null) }}
            className="flex items-center gap-2 text-label-medium text-[#858585] hover:text-[#cccccc] transition-colors"
          >
            <Unlink className="w-4 h-4" />
            {showUnbind ? "收起" : "更换服务器？解绑 IP"}
          </button>

          {showUnbind && (
            <div className="mt-4 space-y-3">
              <p className="text-body-small text-[#858585]">
                输入你的 License Key 解绑当前 IP，下次插件启动时将自动绑定新服务器 IP。
              </p>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#858585]" />
                  <input
                    type="text"
                    value={unbindKey}
                    onChange={(e) => setUnbindKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleUnbind()}
                    placeholder="License Key"
                    className="input-filled w-full pl-10 text-[12px]"
                    disabled={unbinding}
                  />
                </div>
                <button
                  onClick={handleUnbind}
                  disabled={unbinding || !unbindKey.trim()}
                  className="btn btn-outlined px-4 text-[12px]"
                  style={{ 
                    backgroundColor: unbinding ? undefined : '#d97706',
                    borderColor: unbinding ? undefined : '#d97706',
                    color: 'white'
                  }}
                >
                  {unbinding ? "..." : "解绑"}
                </button>
              </div>
              {unbindStatus && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-md ${
                  unbindStatus.type === "success" 
                    ? "bg-green-500/10 border border-green-500/30" 
                    : "bg-red-500/10 border border-red-500/30"
                }`}>
                  {unbindStatus.type === "success" ? (
                    <Check className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span className={`text-[12px] ${unbindStatus.type === "success" ? "text-green-400" : "text-red-400"}`}>
                    {unbindStatus.msg}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
