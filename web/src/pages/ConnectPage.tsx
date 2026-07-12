import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { AlertCircle, Check, KeyRound, Unlink } from "lucide-react"
import { wsClient } from "@/lib/ws-client"
import { useConnectionStore } from "@/store/connection-store"
import { useFileStore } from "@/store/file-store"

export function ConnectPage() {
  const { setConnected, setAuthenticated, setToken, setError, error } = useConnectionStore()
  const { setFileTree, setLoading } = useFileStore()
  const [tokenInput, setTokenInput] = useState("")
  const [connecting, setConnecting] = useState(false)
  const autoConnectTriggered = useRef(false)
  const [showUnbind, setShowUnbind] = useState(false)
  const [unbindKey, setUnbindKey] = useState("")
  const [unbindStatus, setUnbindStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [unbinding, setUnbinding] = useState(false)

  const handleConnect = useCallback(async (token?: string) => {
    const value = token ?? tokenInput
    if (!value.trim()) return
    setConnecting(true)
    setError(null)

    try {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`
      wsClient.setStatusChangeHandler(setConnected)
      wsClient.setReconnectedHandler((serverName, onlineCount) => setAuthenticated(true, serverName, onlineCount))
      wsClient.setReconnectFailedHandler(() => {
        useConnectionStore.getState().setReconnecting(false)
        setError("重连失败，请刷新页面重试")
      })
      await wsClient.connect(wsUrl)
      setConnected(true)
      setToken(value)

      const authResult = await wsClient.auth(value)
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

  useEffect(() => {
    if (autoConnectTriggered.current) return
    const urlToken = new URLSearchParams(window.location.search).get("token")
    if (urlToken) {
      autoConnectTriggered.current = true
      setTokenInput(urlToken)
      void handleConnect(urlToken)
    }
  }, [handleConnect])

  const handleUnbind = async () => {
    if (!unbindKey.trim()) return
    setUnbinding(true)
    setUnbindStatus(null)
    try {
      const response = await fetch("/api/license/ip", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${unbindKey.trim()}` },
      })
      if (response.ok) {
        setUnbindStatus({ type: "success", msg: "IP 已解绑；插件下次连接时会绑定新的服务器 IP。" })
        setUnbindKey("")
      } else {
        const text = await response.text()
        setUnbindStatus({ type: "error", msg: text || "解绑失败，请检查 License Key。" })
      }
    } catch {
      setUnbindStatus({ type: "error", msg: "网络错误，请稍后重试。" })
    } finally {
      setUnbinding(false)
    }
  }

  const submitConnect = (event: FormEvent) => {
    event.preventDefault()
    void handleConnect()
  }

  const submitUnbind = (event: FormEvent) => {
    event.preventDefault()
    void handleUnbind()
  }

  return (
    <main id="main-content" className="access-shell">
      <section className="access-card" aria-labelledby="connect-title">
        <header className="access-header">
          <div className="product-mark" aria-hidden="true">OR</div>
          <div>
            <p className="eyebrow">SERVER WORKSPACE</p>
            <h1 id="connect-title">连接 Orryx Editor</h1>
            <p>使用插件生成的一次性 Token 连接当前 Minecraft 服务器。</p>
          </div>
        </header>

        <form className="industrial-form" onSubmit={submitConnect}>
          <div className="field-group">
            <label htmlFor="connection-token">一次性 Token</label>
            <input id="connection-token" type="text" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)}
              placeholder="输入 Token" autoComplete="off" spellCheck={false} disabled={connecting} />
          </div>
          {error && <div className="status-message status-message--error" role="alert"><AlertCircle aria-hidden="true" />{error}</div>}
          <button className="industrial-button industrial-button--primary" type="submit" disabled={connecting || !tokenInput.trim()}>
            {connecting ? "正在连接…" : "连接服务器"}
          </button>
        </form>

        <div className="access-secondary">
          <button className="industrial-button industrial-button--quiet" type="button" aria-expanded={showUnbind}
            aria-controls="connect-unbind" onClick={() => { setShowUnbind((value) => !value); setUnbindStatus(null) }}>
            <Unlink aria-hidden="true" />{showUnbind ? "收起 IP 解绑" : "更换服务器：解绑 License IP"}
          </button>
          {showUnbind && (
            <form id="connect-unbind" className="industrial-form compact-form" onSubmit={submitUnbind}>
              <p className="consequence-copy">解绑会移除当前服务器 IP。旧服务器将失去绑定，新服务器上的插件在下次连接时会自动占用该绑定。</p>
              <div className="field-group">
                <label htmlFor="unbind-license"><KeyRound aria-hidden="true" />License Key</label>
                <input id="unbind-license" type="text" value={unbindKey} onChange={(event) => setUnbindKey(event.target.value)}
                  placeholder="输入 License Key" autoComplete="off" spellCheck={false} disabled={unbinding} />
              </div>
              <button className="industrial-button industrial-button--warning" type="submit" disabled={unbinding || !unbindKey.trim()}>
                {unbinding ? "正在解绑…" : "确认解绑当前 IP"}
              </button>
              {unbindStatus && (
                <div className={`status-message status-message--${unbindStatus.type}`} role="status" aria-live="polite">
                  {unbindStatus.type === "success" ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                  {unbindStatus.msg}
                </div>
              )}
            </form>
          )}
        </div>
        <footer className="access-footer">Orryx Editor · Minecraft 配置工作台</footer>
      </section>
    </main>
  )
}
