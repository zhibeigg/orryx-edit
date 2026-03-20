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
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]">
      <div className="w-full max-w-sm mx-4">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#007acc] to-[#00b4d8] mb-4 shadow-lg shadow-[#007acc]/20">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Orryx Editor</h1>
          <p className="text-[#94a3b8] text-sm">输入 Token 连接到游戏服务器</p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-[#1e293b]/80 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-[#334155]/50">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#94a3b8]">Token</label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="输入一次性 Token..."
                className="w-full px-4 py-3 bg-[#0f172a] border border-[#334155] rounded-xl text-white placeholder-[#475569] focus:outline-none focus:border-[#007acc] focus:ring-1 focus:ring-[#007acc]/30 transition-all text-sm"
                disabled={connecting}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={() => handleConnect()}
              disabled={connecting || !tokenInput.trim()}
              className="w-full py-3 bg-gradient-to-r from-[#007acc] to-[#00b4d8] text-white font-medium rounded-xl hover:from-[#0098ff] hover:to-[#22d3ee] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#007acc]/20 hover:shadow-[#007acc]/30"
            >
              {connecting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  连接中...
                </span>
              ) : "连接"}
            </button>
          </div>

          {/* 解绑区域 */}
          <div className="mt-6 pt-6 border-t border-[#334155]/50">
            <button
              onClick={() => { setShowUnbind(!showUnbind); setUnbindStatus(null) }}
              className="flex items-center gap-2 text-[#64748b] hover:text-[#94a3b8] transition-colors text-sm"
            >
              <Unlink className="w-4 h-4" />
              {showUnbind ? "收起" : "更换服务器？解绑 IP"}
            </button>

            {showUnbind && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-[#64748b]">
                  输入你的 License Key 解绑当前 IP，下次插件启动时将自动绑定新服务器 IP。
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#475569]" />
                    <input
                      type="text"
                      value={unbindKey}
                      onChange={(e) => setUnbindKey(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleUnbind()}
                      placeholder="License Key"
                      className="w-full pl-10 pr-4 py-2.5 bg-[#0f172a] border border-[#334155] rounded-xl text-white placeholder-[#475569] focus:outline-none focus:border-[#f59e0b] focus:ring-1 focus:ring-[#f59e0b]/30 transition-all text-xs"
                      disabled={unbinding}
                    />
                  </div>
                  <button
                    onClick={handleUnbind}
                    disabled={unbinding || !unbindKey.trim()}
                    className="px-4 py-2.5 bg-gradient-to-r from-[#f59e0b] to-[#d97706] text-white font-medium rounded-xl hover:from-[#fbbf24] hover:to-[#f59e0b] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs whitespace-nowrap"
                  >
                    {unbinding ? "..." : "解绑"}
                  </button>
                </div>
                {unbindStatus && (
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs ${
                    unbindStatus.type === "success" 
                      ? "bg-emerald-500/10 border border-emerald-500/30" 
                      : "bg-red-500/10 border border-red-500/30"
                  }`}>
                    {unbindStatus.type === "success" ? (
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span className={unbindStatus.type === "success" ? "text-emerald-400" : "text-red-400"}>
                      {unbindStatus.msg}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 底部信息 */}
        <p className="text-center text-xs text-[#475569] mt-6">
          Orryx Editor · Minecraft 配置可视化编辑器
        </p>
      </div>
    </div>
  )
}
