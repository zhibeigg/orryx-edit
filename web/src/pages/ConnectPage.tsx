import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleDot,
  KeyRound,
  Link2Off,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ServerOff,
  TerminalSquare,
  Unlink,
} from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import { extractAndScrubUrlToken } from "@/lib/connection-credential"
import { resynchronizeOpenFiles } from "@/lib/server-file"
import {
  isPermanentAuthenticationError,
  wsClient,
  WsRequestError,
  type AuthSession,
} from "@/lib/ws-client"
import { useConnectionStore } from "@/store/connection-store"
import { useFileStore } from "@/store/file-store"
import { apiFetch } from "@/lib/api-client"

type ConnectPhase = "idle" | "authenticating" | "loading" | "error" | "unsafe"

function connectionFailureMessage(cause: unknown): string {
  if (cause instanceof WsRequestError) {
    if (cause.code === "INVALID_TOKEN") {
      return "这条连接链接已过期或已经使用。请回到游戏重新执行 /orryx edit。"
    }
    if (cause.code === "SERVER_OFFLINE") {
      return "游戏服务器已经离线，无法打开对应工作区。请确认插件在线后刷新页面，或重新执行 /orryx edit。"
    }
    if (cause.code === "LICENSE_INACTIVE") {
      return "服务器授权当前不可用。请在 Portal 检查 License 状态后重新生成链接。"
    }
    return cause.message
  }
  if (cause instanceof Error) {
    if (/websocket|network|connect|timeout/i.test(cause.message)) {
      return "无法连接到 Orryx 中心服务。请检查网络和服务器状态后重新执行 /orryx edit。"
    }
    return cause.message
  }
  return "连接失败。请回到游戏重新执行 /orryx edit。"
}

export function ConnectPage() {
  const { setConnected, setAuthenticated, setError, error } = useConnectionStore()
  const { setFileTree, setLoading } = useFileStore()
  const [phase, setPhase] = useState<ConnectPhase>("idle")
  const [resumeExpired, setResumeExpired] = useState(false)
  const autoConnectTriggered = useRef(false)
  const [unbindKey, setUnbindKey] = useState("")
  const [unbindStatus, setUnbindStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [unbinding, setUnbinding] = useState(false)

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    setLoading(true)
    try {
      const fileResult = await wsClient.fileList()
      if (useConnectionStore.getState().workspaceId === workspaceId) {
        setFileTree(fileResult.files)
      }
    } finally {
      if (useConnectionStore.getState().workspaceId === workspaceId) {
        setLoading(false)
      }
    }
  }, [setFileTree, setLoading])

  const applySession = useCallback(async (session: AuthSession): Promise<string> => {
    if (!await setAuthenticated(true, session)) {
      throw new Error(useConnectionStore.getState().error ?? "无法安全切换编辑工作区")
    }
    const workspaceId = useConnectionStore.getState().workspaceId
    if (!workspaceId) throw new Error("认证响应缺少 workspaceId")
    return workspaceId
  }, [setAuthenticated])

  const configureClient = useCallback(() => {
    wsClient.setStatusChangeHandler(setConnected)
    wsClient.setReconnectedHandler((session) => {
      void applySession(session)
        .then(async (workspaceId) => {
          await resynchronizeOpenFiles(workspaceId)
          await loadWorkspace(workspaceId)
        })
        .catch((reconnectError) => setError(connectionFailureMessage(reconnectError)))
    })
    wsClient.setReconnectFailedHandler((reconnectError) => {
      void setAuthenticated(false).then((cleared) => {
        setError(cleared
          ? `恢复连接失败：${reconnectError.message}。请刷新页面，或回到游戏重新执行 /orryx edit。`
          : `恢复连接失败，且草稿持久化失败；当前工作区已保留：${reconnectError.message}`)
      })
    })
    wsClient.setAuthenticationLostHandler((authError) => {
      void setAuthenticated(false).then((cleared) => {
        setError(cleared
          ? `编辑会话已失效：${authError.message}`
          : `编辑会话已失效，且草稿持久化失败；当前工作区已保留：${authError.message}`)
      })
    })
  }, [applySession, loadWorkspace, setAuthenticated, setConnected, setError])

  const connectSocket = useCallback(async () => {
    configureClient()
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`
    await wsClient.connect(wsUrl)
  }, [configureClient])

  const handleConnect = useCallback(async (token: string) => {
    setPhase("authenticating")
    setError(null)
    try {
      await connectSocket()
      const session = await wsClient.auth(token)
      const workspaceId = await applySession(session)
      setPhase("loading")
      await resynchronizeOpenFiles(workspaceId)
      await loadWorkspace(workspaceId)
    } catch (connectError) {
      wsClient.disconnect(false)
      setError(connectionFailureMessage(connectError))
      setPhase("error")
    }
  }, [applySession, connectSocket, loadWorkspace, setError])

  const handleResume = useCallback(async () => {
    setPhase("authenticating")
    setError(null)
    try {
      await connectSocket()
      const session = await wsClient.resume()
      const workspaceId = await applySession(session)
      setPhase("loading")
      await resynchronizeOpenFiles(workspaceId)
      await loadWorkspace(workspaceId)
    } catch (resumeError) {
      wsClient.disconnect(false)
      if (isPermanentAuthenticationError(resumeError)) {
        setResumeExpired(true)
        setPhase("idle")
        return
      }
      setError(connectionFailureMessage(resumeError))
      setPhase("error")
    }
  }, [applySession, connectSocket, loadWorkspace, setError])

  useEffect(() => {
    if (autoConnectTriggered.current) return
    autoConnectTriggered.current = true
    const credential = extractAndScrubUrlToken()
    if (credential.rejectedQueryToken) {
      setError(null)
      setPhase("unsafe")
    } else if (credential.token) {
      void handleConnect(credential.token)
    } else if (wsClient.hasResumeSession()) {
      void handleResume()
    }
  }, [handleConnect, handleResume, setError])

  const submitUnbind = async (event: FormEvent) => {
    event.preventDefault()
    if (!unbindKey.trim()) return
    setUnbinding(true)
    setUnbindStatus(null)
    try {
      const response = await apiFetch("/api/license/ip", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${unbindKey.trim()}` },
      })
      if (response.ok) {
        setUnbindStatus({ type: "success", msg: "IP 已解绑。插件下次连接时会绑定新的服务器 IP。" })
        setUnbindKey("")
      } else {
        const payload = await response.json().catch(() => null) as { message?: string } | null
        setUnbindStatus({ type: "error", msg: payload?.message ?? "解绑失败。请检查 License Key 后重试。" })
      }
    } catch {
      setUnbindStatus({ type: "error", msg: "无法连接到解绑服务。请检查网络后重试。" })
    } finally {
      setUnbinding(false)
    }
  }

  const loading = phase === "authenticating" || phase === "loading"

  return (
    <main id="main-content" className="access-shell connect-shell">
      <nav className="connect-route-nav" aria-label="连接页导航">
        <a href="/">插件门户</a>
        <a href="/portal">账户控制台</a>
      </nav>

      <section className="access-card connect-card" aria-labelledby="connect-title">
        <header className="access-header connect-header">
          <BrandMark className="brand-mark connect-brand-mark" />
          <div>
            <p className="eyebrow">SERVER WORKSPACE LINK</p>
            <h1 id="connect-title">连接 Orryx Editor</h1>
            <p>一次性链接由游戏内玩家命令生成，页面会自动验证并打开对应服务器。</p>
          </div>
        </header>

        {phase === "idle" && (
          <div className="connect-state connect-state--idle">
            {resumeExpired && <p className="status-message" role="status">上次编辑会话已经失效，请生成新的连接链接。</p>}
            {!resumeExpired && error && <p className="status-message status-message--error" role="alert">{error}</p>}
            <div className="connect-command">
              <span>IN-GAME COMMAND</span>
              <code>/orryx edit</code>
              <small>必须由玩家在 Minecraft 服务器内执行</small>
            </div>
            <ol className="connect-instructions">
              <li><span>01</span><TerminalSquare aria-hidden="true" /><p>执行命令后，点击聊天中的“打开编辑器”文本。</p></li>
              <li><span>02</span><LockKeyhole aria-hidden="true" /><p>链接约 5 分钟有效，只能使用一次。</p></li>
              <li><span>03</span><CheckCircle2 aria-hidden="true" /><p>凭据读取后立即从地址栏清除，不会保存到浏览器。</p></li>
            </ol>
          </div>
        )}

        {loading && (
          <div className="connect-state connect-state--progress" aria-live="polite" aria-busy="true">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            <div>
              <strong>{phase === "authenticating" ? "正在验证一次性链接" : "正在加载服务器工作区"}</strong>
              <p>{phase === "authenticating" ? "凭据已经从地址栏清除，正在与中心服务建立安全会话。" : "身份验证已通过，正在读取文件树和协作状态。"}</p>
            </div>
            <ol className="connect-progress-rail" aria-label="连接进度">
              <li className="is-complete"><Check aria-hidden="true" />清除地址栏凭据</li>
              <li className={phase === "loading" ? "is-complete" : "is-current"}>{phase === "loading" ? <Check aria-hidden="true" /> : <CircleDot aria-hidden="true" />}验证单次 Token</li>
              <li className={phase === "loading" ? "is-current" : ""}><CircleDot aria-hidden="true" />加载工作区</li>
            </ol>
          </div>
        )}

        {phase === "unsafe" && (
          <div className="connect-state connect-state--error" role="alert">
            <Link2Off aria-hidden="true" />
            <div>
              <strong>已拒绝查询参数中的 Token</strong>
              <p>查询参数可能进入代理和应用日志。地址栏已清理；请回到游戏重新执行 <code>/orryx edit</code>，使用新的 Fragment 链接。</p>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="connect-state connect-state--error" role="alert">
            {error?.includes("离线") ? <ServerOff aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <div>
              <strong>没有打开服务器工作区</strong>
              <p>{error}</p>
              <a className="industrial-button industrial-button--quiet" href="/connect"><RefreshCw aria-hidden="true" />返回连接说明</a>
            </div>
          </div>
        )}

        <details className="connect-unbind">
          <summary><Unlink aria-hidden="true" />更换服务器：解绑 License IP</summary>
          <form className="industrial-form compact-form" onSubmit={(event) => void submitUnbind(event)}>
            <p className="consequence-copy">解绑会移除当前服务器 IP。旧服务器将失去绑定，新服务器上的插件在下次连接时会自动占用该绑定。</p>
            <div className="field-group">
              <label htmlFor="unbind-license"><KeyRound aria-hidden="true" />License Key</label>
              <input
                id="unbind-license"
                type="password"
                value={unbindKey}
                onChange={(event) => setUnbindKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={unbinding}
              />
            </div>
            <button className="industrial-button industrial-button--warning" type="submit" disabled={unbinding || !unbindKey.trim()}>
              {unbinding ? "正在解绑…" : "解绑当前 IP"}
            </button>
            {unbindStatus && (
              <div className={`status-message status-message--${unbindStatus.type}`} role="status" aria-live="polite">
                {unbindStatus.type === "success" ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
                {unbindStatus.msg}
              </div>
            )}
          </form>
        </details>

        <footer className="access-footer connect-footer">Fragment 内存消费 · 单次使用 · 约 300 秒过期</footer>
      </section>
    </main>
  )
}
