import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { AlertCircle, Check, KeyRound, Unlink } from "lucide-react"
import { wsClient, type AuthSession } from "@/lib/ws-client"
import { useConnectionStore } from "@/store/connection-store"
import { useFileStore } from "@/store/file-store"
import { apiFetch } from "@/lib/api-client"

function extractAndScrubUrlToken(): string | null {
  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
  const token = hashParams.get("token") ?? url.searchParams.get("token")
  if (!token) return null

  // 认证网络请求开始前即清除地址栏中的一次性凭据，避免进入历史记录、截图或复制链接。
  hashParams.delete("token")
  url.searchParams.delete("token")
  url.hash = hashParams.toString() ? `#${hashParams.toString()}` : ""
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  return token
}

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

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const fileResult = await wsClient.fileList()
      setFileTree(fileResult.files)
    } finally {
      setLoading(false)
    }
  }, [setFileTree, setLoading])

  const applySession = useCallback((session: AuthSession) => {
    setAuthenticated(true, session)
    setToken(null)
  }, [setAuthenticated, setToken])

  const configureClient = useCallback(() => {
    wsClient.setStatusChangeHandler(setConnected)
    wsClient.setReconnectedHandler((session) => {
      applySession(session)
      void loadWorkspace()
    })
    wsClient.setReconnectFailedHandler(() => {
      useConnectionStore.getState().setReconnecting(false)
      setError("重连失败，请刷新页面重试")
    })
    wsClient.setAuthenticationLostHandler((authError) => {
      setAuthenticated(false)
      setError(`会话已失效：${authError.message}`)
    })
  }, [applySession, loadWorkspace, setAuthenticated, setConnected, setError])

  const connectSocket = useCallback(async () => {
    configureClient()
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`
    await wsClient.connect(wsUrl)
  }, [configureClient])

  const handleConnect = useCallback(async (token?: string) => {
    const value = (token ?? tokenInput).trim()
    if (!value) return
    setConnecting(true)
    setError(null)

    try {
      await connectSocket()
      const session = await wsClient.auth(value)
      applySession(session)
      setTokenInput("")
      await loadWorkspace()
    } catch (connectError) {
      wsClient.disconnect(false)
      setError(connectError instanceof Error ? connectError.message : "连接失败")
    } finally {
      setConnecting(false)
    }
  }, [applySession, connectSocket, loadWorkspace, setError, tokenInput])

  const handleResume = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      await connectSocket()
      const session = await wsClient.resume()
      applySession(session)
      await loadWorkspace()
    } catch {
      wsClient.clearResumeSession()
      wsClient.disconnect(false)
      setAuthenticated(false)
    } finally {
      setConnecting(false)
    }
  }, [applySession, connectSocket, loadWorkspace, setAuthenticated, setError])

  useEffect(() => {
    if (autoConnectTriggered.current) return
    autoConnectTriggered.current = true
    const urlToken = extractAndScrubUrlToken()
    if (urlToken) {
      setTokenInput(urlToken)
      void handleConnect(urlToken)
    } else if (wsClient.hasResumeSession()) {
      void handleResume()
    }
  }, [handleConnect, handleResume])

  const handleUnbind = async () => {
    if (!unbindKey.trim()) return
    setUnbinding(true)
    setUnbindStatus(null)
    try {
      const response = await apiFetch("/api/license/ip", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${unbindKey.trim()}` },
      })
      if (response.ok) {
        setUnbindStatus({ type: "success", msg: "IP 已解绑；插件下次连接时会绑定新的服务器 IP。" })
        setUnbindKey("")
      } else {
        const payload = await response.json().catch(() => null) as { message?: string } | null
        setUnbindStatus({ type: "error", msg: payload?.message ?? "解绑失败，请检查 License Key。" })
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
            <input id="connection-token" type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)}
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
                <input id="unbind-license" type="password" value={unbindKey} onChange={(event) => setUnbindKey(event.target.value)}
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
