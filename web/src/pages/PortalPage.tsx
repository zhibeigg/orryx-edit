import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Clock, Key, LogOut, MapPin, Server, Unlink } from "lucide-react"

interface LicenseInfo {
  license: string
  owner: string
  enabled: boolean
  online: boolean
  expiresAt: number
  boundIps: string[]
  remainingDays: number
}

function licenseApi(license: string, path: string, method = "GET") {
  return fetch(`/api/license${path}`, {
    method,
    headers: { Authorization: `Bearer ${license}`, "Content-Type": "application/json" },
  })
}

export function PortalPage() {
  const [license, setLicense] = useState(() => sessionStorage.getItem("portalLicense") ?? "")
  const [authed, setAuthed] = useState(false)
  const [info, setInfo] = useState<LicenseInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const [confirmingUnbind, setConfirmingUnbind] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await licenseApi(license, "/info")
      if (!response.ok) {
        setError("License 无效或已被禁用。")
        setAuthed(false)
        return
      }
      setInfo(await response.json())
      setError(null)
      setAuthed(true)
      sessionStorage.setItem("portalLicense", license)
    } catch {
      setError("连接失败，请稍后重试。")
    }
  }, [license])

  useEffect(() => {
    if (license) void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (event: FormEvent) => {
    event.preventDefault()
    if (license.trim()) void load()
  }

  const handleUnbindIp = async () => {
    setUnbinding(true)
    setStatus(null)
    try {
      const response = await licenseApi(license, "/ip", "DELETE")
      if (!response.ok) throw new Error("unbind failed")
      await load()
      setStatus("IP 已解绑。新服务器上的插件可在下次连接时绑定此 License。")
      setConfirmingUnbind(false)
    } catch {
      setStatus("解绑失败，请稍后重试。")
    } finally {
      setUnbinding(false)
    }
  }

  if (!authed) {
    return (
      <main id="main-content" className="access-shell">
        <section className="access-card" aria-labelledby="portal-login-title">
          <header className="access-header">
            <div className="product-mark" aria-hidden="true"><Key /></div>
            <div><p className="eyebrow">LICENSE PORTAL</p><h1 id="portal-login-title">License 门户</h1><p>查看授权状态、有效期和服务器 IP 绑定。</p></div>
          </header>
          <form className="industrial-form" onSubmit={handleLogin}>
            <div className="field-group">
              <label htmlFor="portal-license">License Key</label>
              <input id="portal-license" type="text" value={license} onChange={(event) => setLicense(event.target.value)}
                placeholder="输入 License" autoComplete="off" spellCheck={false} />
            </div>
            {error && <p className="status-message status-message--error" role="alert">{error}</p>}
            <button className="industrial-button industrial-button--primary" type="submit" disabled={!license.trim()}>查看授权信息</button>
          </form>
        </section>
      </main>
    )
  }

  if (!info) return null
  const expiryClass = info.expiresAt !== 0 && info.remainingDays <= 7 ? "state-danger" : info.remainingDays <= 30 ? "state-warning" : ""
  const expiryText = info.expiresAt === 0 ? "永久有效" : info.remainingDays <= 0 ? "已过期" : `剩余 ${info.remainingDays} 天 · ${new Date(info.expiresAt).toLocaleDateString("zh-CN")} 到期`

  return (
    <main id="main-content" className="portal-shell">
      <section className="portal-panel" aria-labelledby="portal-title">
        <header className="portal-header">
          <div><p className="eyebrow">LICENSE PORTAL</p><h1 id="portal-title">授权信息</h1><p>{info.owner || "未设置授权所有者"}</p></div>
          <button className="industrial-button industrial-button--quiet" type="button" onClick={() => { setAuthed(false); sessionStorage.removeItem("portalLicense") }}>
            <LogOut aria-hidden="true" />退出
          </button>
        </header>

        <dl className="detail-grid">
          <Detail icon={<Key />} label="License"><code>{info.license}</code></Detail>
          <Detail icon={<Server />} label="运行状态">
            <span className={`state-label ${!info.enabled ? "state-danger" : info.online ? "state-success" : ""}`}>
              {!info.enabled ? "已禁用" : info.online ? "服务器在线" : "服务器离线"}
            </span>
          </Detail>
          <Detail icon={<Clock />} label="有效期"><span className={expiryClass}>{expiryText}</span></Detail>
        </dl>

        <section className="binding-panel" aria-labelledby="binding-title">
          <div className="section-heading"><MapPin aria-hidden="true" /><div><h2 id="binding-title">服务器 IP 绑定</h2><p>一个 License 的当前服务器身份。</p></div></div>
          {info.boundIps.length > 0 ? (
            <>
              <code className="long-value">{info.boundIps.join(", ")}</code>
              <p className="consequence-copy">解绑后，当前服务器不再拥有此 License 的 IP 绑定；新服务器插件下次连接时可自动绑定。</p>
              <button className="industrial-button industrial-button--warning" type="button" onClick={() => setConfirmingUnbind(true)}>
                <Unlink aria-hidden="true" />解绑当前 IP
              </button>
            </>
          ) : <p className="empty-copy">尚未绑定。插件下次成功连接时会自动绑定服务器 IP。</p>}
          {status && <p className="status-message" role="status" aria-live="polite">{status}</p>}
        </section>
      </section>

      {confirmingUnbind && (
        <UnbindConfirm
          unbinding={unbinding}
          onCancel={() => setConfirmingUnbind(false)}
          onConfirm={() => void handleUnbindIp()}
        />
      )}
    </main>
  )
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="detail-item"><dt>{icon}<span>{label}</span></dt><dd>{children}</dd></div>
}

function UnbindConfirm({
  unbinding,
  onCancel,
  onConfirm,
}: {
  unbinding: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !unbinding) onCancel()
    }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [onCancel, unbinding])

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unbind-confirm-title"
        aria-describedby="unbind-confirm-description"
      >
        <h2 id="unbind-confirm-title">解绑当前服务器 IP？</h2>
        <p id="unbind-confirm-description">
          当前服务器将立即失去此 License 的 IP 绑定。请只在准备迁移到新服务器时执行此操作。
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} className="industrial-button industrial-button--quiet" type="button" onClick={onCancel} disabled={unbinding}>
            保留当前绑定
          </button>
          <button className="industrial-button industrial-button--danger" type="button" onClick={onConfirm} disabled={unbinding}>
            {unbinding ? "正在解绑…" : "解绑服务器 IP"}
          </button>
        </div>
      </section>
    </div>
  )
}
