import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Ban, Check, Clock, Copy, Key, Plus, RefreshCw, RotateCcw, Shield } from "lucide-react"

interface License {
  license: string
  owner: string
  serverKey: string
  enabled: boolean
  online: boolean
  onlineCount: number
  createdAt: number
  expiresAt: number
  boundIps: string[]
  remainingDays: number
}

interface Stats { servers: number; browsers: number; tokens: number; licenses: number }

function api(adminKey: string, path: string, method = "GET", body?: unknown) {
  return fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("adminKey") ?? "")
  const [authed, setAuthed] = useState(false)
  const [licenses, setLicenses] = useState<License[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [newOwner, setNewOwner] = useState("")
  const [newDays, setNewDays] = useState(30)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renewTarget, setRenewTarget] = useState<string | null>(null)
  const [renewDays, setRenewDays] = useState(30)

  const load = useCallback(async () => {
    try {
      const [licenseResponse, statsResponse] = await Promise.all([api(adminKey, "/licenses"), api(adminKey, "/stats")])
      if (!licenseResponse.ok) {
        setError("Admin Key 无效或已失效。")
        setAuthed(false)
        return
      }
      setLicenses(await licenseResponse.json())
      if (statsResponse.ok) setStats(await statsResponse.json())
      setError(null)
      setAuthed(true)
      sessionStorage.setItem("adminKey", adminKey)
    } catch {
      setError("无法连接管理服务，请稍后重试。")
    }
  }, [adminKey])

  useEffect(() => {
    if (adminKey) void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authed) return
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [authed, load])

  const handleLogin = (event: FormEvent) => {
    event.preventDefault()
    if (adminKey.trim()) void load()
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!newOwner.trim()) return
    setCreating(true)
    try {
      const response = await api(adminKey, "/license", "POST", { owner: newOwner.trim(), days: newDays })
      if (response.ok) { setNewOwner(""); await load() }
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (license: string, enabled: boolean) => {
    await api(adminKey, `/license/${license}`, enabled ? "DELETE" : "PUT")
    await load()
  }

  const handleRenew = async () => {
    if (!renewTarget) return
    await api(adminKey, `/license/${renewTarget}/renew`, "POST", { days: renewDays })
    setRenewTarget(null)
    await load()
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(text)
    window.setTimeout(() => setCopied(null), 1500)
  }

  if (!authed) {
    return (
      <main id="main-content" className="access-shell">
        <section className="access-card" aria-labelledby="admin-login-title">
          <header className="access-header">
            <div className="product-mark" aria-hidden="true"><Shield /></div>
            <div><p className="eyebrow">ADMIN CONTROL</p><h1 id="admin-login-title">Orryx 管理后台</h1><p>管理 License、服务器绑定与在线状态。</p></div>
          </header>
          <form className="industrial-form" onSubmit={handleLogin}>
            <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />
            <div className="field-group">
              <label htmlFor="admin-key">Admin Key</label>
              <input id="admin-key" type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)}
                placeholder="输入管理密钥" autoComplete="current-password" />
            </div>
            {error && <p className="status-message status-message--error" role="alert" aria-live="assertive">{error}</p>}
            <button className="industrial-button industrial-button--primary" type="submit" disabled={!adminKey.trim()}>登录管理后台</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand"><span className="product-mark product-mark--small" aria-hidden="true"><Shield /></span><div><strong>Orryx Admin</strong><span>License 控制台</span></div></div>
        <button className="industrial-button industrial-button--quiet" type="button" onClick={() => { setAuthed(false); sessionStorage.removeItem("adminKey") }}>退出</button>
      </header>

      <main id="main-content" className="admin-main">
        <div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h1>License 管理</h1><p>创建、续费、停用并检查服务器绑定状态。</p></div><button className="industrial-button industrial-button--quiet" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />刷新</button></div>

        {stats && (
          <dl className="status-strip" aria-label="系统状态">
            <StatusItem label="License" value={stats.licenses} />
            <StatusItem label="在线服务器" value={stats.servers} />
            <StatusItem label="浏览器会话" value={stats.browsers} />
            <StatusItem label="活跃 Token" value={stats.tokens} />
          </dl>
        )}

        <section className="industrial-panel" aria-labelledby="create-license-title">
          <div className="section-heading"><Plus aria-hidden="true" /><div><h2 id="create-license-title">创建 License</h2><p>为新的服务器所有者签发授权。</p></div></div>
          <form className="create-license-form" onSubmit={handleCreate}>
            <div className="field-group"><label htmlFor="license-owner">用户名 / 备注</label><input id="license-owner" type="text" value={newOwner} onChange={(event) => setNewOwner(event.target.value)} placeholder="例如：生存服主节点" /></div>
            <div className="field-group"><label htmlFor="license-days">有效期</label><select id="license-days" value={newDays} onChange={(event) => setNewDays(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={180}>180 天</option><option value={365}>365 天</option><option value={0}>永久</option></select></div>
            <button className="industrial-button industrial-button--primary" type="submit" disabled={creating || !newOwner.trim()}><Plus aria-hidden="true" />{creating ? "创建中…" : "创建"}</button>
          </form>
        </section>

        <section className="industrial-panel license-section" aria-labelledby="license-list-title">
          <div className="section-heading"><Key aria-hidden="true" /><div><h2 id="license-list-title">License 列表</h2><p>共 {licenses.length} 条授权记录。</p></div></div>
          {licenses.length === 0 ? <p className="empty-copy">暂无 License。</p> : <>
            <div className="license-table-wrap">
              <table className="license-table">
                <thead><tr><th>License</th><th>用户</th><th>状态</th><th>到期</th><th>绑定 IP</th><th>操作</th></tr></thead>
                <tbody>{licenses.map((item) => <LicenseTableRow key={item.license} item={item} copied={copied === item.license} onCopy={handleCopy} onRenew={setRenewTarget} onToggle={handleToggle} />)}</tbody>
              </table>
            </div>
            <div className="license-card-list">{licenses.map((item) => <LicenseCard key={item.license} item={item} copied={copied === item.license} onCopy={handleCopy} onRenew={setRenewTarget} onToggle={handleToggle} />)}</div>
          </>}
        </section>
      </main>

      {renewTarget && (
        <div className="dialog-backdrop">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="renew-title">
            <h2 id="renew-title">续费 License</h2><code className="long-value">{renewTarget}</code>
            <div className="field-group"><label htmlFor="renew-days">增加有效期</label><select id="renew-days" value={renewDays} onChange={(event) => setRenewDays(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={180}>180 天</option><option value={365}>365 天</option></select></div>
            <div className="dialog-actions"><button className="industrial-button industrial-button--quiet" type="button" onClick={() => setRenewTarget(null)}>取消</button><button className="industrial-button industrial-button--primary" type="button" onClick={() => void handleRenew()}>确认续费</button></div>
          </section>
        </div>
      )}
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: number }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }

function Expiry({ item }: { item: License }) {
  if (item.expiresAt === 0) return <span>永久</span>
  if (item.remainingDays <= 0) return <span className="state-danger">已过期</span>
  return <span className={item.remainingDays <= 7 ? "state-danger" : item.remainingDays <= 30 ? "state-warning" : ""}><Clock aria-hidden="true" />{item.remainingDays} 天</span>
}

function LicenseActions({ item, onRenew, onToggle }: { item: License; onRenew: (license: string) => void; onToggle: (license: string, enabled: boolean) => Promise<void> }) {
  return <div className="license-actions"><button className="industrial-button industrial-button--quiet" type="button" onClick={() => onRenew(item.license)}><RefreshCw aria-hidden="true" />续费</button><button className={`industrial-button ${item.enabled ? "industrial-button--danger-quiet" : "industrial-button--success"}`} type="button" onClick={() => void onToggle(item.license, item.enabled)}>{item.enabled ? <><Ban aria-hidden="true" />禁用</> : <><RotateCcw aria-hidden="true" />恢复</>}</button></div>
}

const statusText = (item: License) => !item.enabled ? "已禁用" : item.online ? `在线 · ${item.onlineCount} 子服` : "离线"

function CopyLicense({ item, copied, onCopy }: { item: License; copied: boolean; onCopy: (text: string) => Promise<void> }) {
  return <div className="copy-value"><code>{item.license}</code><button type="button" aria-label={`复制 License ${item.license}`} onClick={() => void onCopy(item.license)}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button></div>
}

function LicenseTableRow({ item, copied, onCopy, onRenew, onToggle }: { item: License; copied: boolean; onCopy: (text: string) => Promise<void>; onRenew: (license: string) => void; onToggle: (license: string, enabled: boolean) => Promise<void> }) {
  return <tr><td><CopyLicense item={item} copied={copied} onCopy={onCopy} /></td><td>{item.owner}</td><td><span className={!item.enabled ? "state-danger" : item.online ? "state-success" : ""}>{statusText(item)}</span></td><td><Expiry item={item} /></td><td><code className="long-value">{item.boundIps.length ? item.boundIps.join(", ") : "未绑定"}</code></td><td><LicenseActions item={item} onRenew={onRenew} onToggle={onToggle} /></td></tr>
}

function LicenseCard({ item, copied, onCopy, onRenew, onToggle }: { item: License; copied: boolean; onCopy: (text: string) => Promise<void>; onRenew: (license: string) => void; onToggle: (license: string, enabled: boolean) => Promise<void> }) {
  return <article className="license-card"><CopyLicense item={item} copied={copied} onCopy={onCopy} /><dl><div><dt>用户</dt><dd>{item.owner}</dd></div><div><dt>状态</dt><dd className={!item.enabled ? "state-danger" : item.online ? "state-success" : ""}>{statusText(item)}</dd></div><div><dt>到期</dt><dd><Expiry item={item} /></dd></div><div><dt>绑定 IP</dt><dd><code className="long-value">{item.boundIps.length ? item.boundIps.join(", ") : "未绑定"}</code></dd></div></dl><LicenseActions item={item} onRenew={onRenew} onToggle={onToggle} /></article>
}
