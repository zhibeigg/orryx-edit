import { useState, useEffect, useCallback } from "react"
import { Shield, Plus, Copy, Check, Ban, RotateCcw, Server, Users, Key, Globe, Clock, RefreshCw } from "lucide-react"

interface License {
  license: string
  owner: string
  serverKey: string
  enabled: boolean
  online: boolean
  createdAt: number
  expiresAt: number
  boundIp: string
  remainingDays: number
}

interface Stats {
  servers: number
  browsers: number
  tokens: number
  licenses: number
}

function api(adminKey: string, path: string, method = "GET", body?: unknown) {
  return fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// SPLICE_1

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
      const [licRes, statRes] = await Promise.all([api(adminKey, "/licenses"), api(adminKey, "/stats")])
      if (!licRes.ok) { setError("Admin Key 无效"); setAuthed(false); return }
      setLicenses(await licRes.json())
      setStats(await statRes.json())
      setError(null)
      setAuthed(true)
      sessionStorage.setItem("adminKey", adminKey)
    } catch { setError("连接失败") }
  }, [adminKey])

  const handleLogin = async () => { if (adminKey.trim()) await load() }
  useEffect(() => { if (adminKey) handleLogin() }, []) // eslint-disable-line
  useEffect(() => { if (!authed) return; const t = setInterval(load, 5000); return () => clearInterval(t) }, [authed, load])

  const handleCreate = async () => {
    if (!newOwner.trim()) return
    setCreating(true)
    try {
      const res = await api(adminKey, "/license", "POST", { owner: newOwner.trim(), days: newDays })
      if (res.ok) { setNewOwner(""); await load() }
    } finally { setCreating(false) }
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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!authed) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0e14]">
        <div className="w-full max-w-sm p-8 space-y-6">
          <div className="text-center space-y-2">
            <Shield className="w-10 h-10 mx-auto text-zinc-400" />
            <h1 className="text-2xl font-bold text-zinc-100">Orryx Admin</h1>
          </div>
          <div className="space-y-3">
            <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Admin Key"
              className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600" />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button onClick={handleLogin} className="w-full py-3 rounded-lg bg-zinc-100 text-zinc-900 font-medium hover:bg-zinc-200">登录</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0e14] text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-zinc-400" />
          <span className="font-bold text-lg">Orryx Admin</span>
        </div>
        <button onClick={() => { setAuthed(false); sessionStorage.removeItem("adminKey") }} className="text-sm text-zinc-500 hover:text-zinc-300">退出</button>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <StatCard icon={Key} label="License 总数" value={stats.licenses} />
            <StatCard icon={Server} label="在线服务器" value={stats.servers} />
            <StatCard icon={Globe} label="在线浏览器" value={stats.browsers} />
            <StatCard icon={Users} label="活跃 Token" value={stats.tokens} />
          </div>
        )}

        {/* 创建 License */}
        <div className="flex gap-3">
          <input type="text" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()} placeholder="用户名 / 备注"
            className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600" />
          <select value={newDays} onChange={(e) => setNewDays(Number(e.target.value))}
            className="px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600">
            <option value={7}>7 天</option>
            <option value={30}>30 天</option>
            <option value={90}>90 天</option>
            <option value={180}>180 天</option>
            <option value={365}>365 天</option>
            <option value={0}>永久</option>
          </select>
          <button onClick={handleCreate} disabled={creating || !newOwner.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 font-medium hover:bg-zinc-200 disabled:opacity-40">
            <Plus className="w-4 h-4" />创建
          </button>
        </div>

        {/* 续费弹窗 */}
        {renewTarget && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setRenewTarget(null)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-80 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold">续费 License</h3>
              <p className="text-xs text-zinc-400 font-mono">{renewTarget}</p>
              <div className="flex gap-2">
                <select value={renewDays} onChange={(e) => setRenewDays(Number(e.target.value))}
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100">
                  <option value={7}>+7 天</option>
                  <option value={30}>+30 天</option>
                  <option value={90}>+90 天</option>
                  <option value={180}>+180 天</option>
                  <option value={365}>+365 天</option>
                </select>
                <button onClick={handleRenew} className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-900 font-medium hover:bg-zinc-200">确认</button>
              </div>
            </div>
          </div>
        )}

        {/* License 表格 */}
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/50 text-zinc-400 text-left">
                <th className="px-4 py-3 font-medium">License</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">到期</th>
                <th className="px-4 py-3 font-medium">绑定 IP</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {licenses.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600">暂无 License</td></tr>
              )}
              {licenses.map((lic) => (
                <tr key={lic.license} className="border-t border-zinc-800/50 hover:bg-zinc-900/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-zinc-900 px-2 py-1 rounded font-mono">{lic.license}</code>
                      <button onClick={() => handleCopy(lic.license)} className="text-zinc-600 hover:text-zinc-300">
                        {copied === lic.license ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{lic.owner}</td>
                  <td className="px-4 py-3">
                    {lic.enabled ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full ${lic.online ? "bg-green-400" : "bg-zinc-600"}`} />
                        {lic.online ? "在线" : "离线"}
                      </span>
                    ) : (
                      <span className="text-xs text-red-400">已禁用</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <ExpiryBadge expiresAt={lic.expiresAt} remainingDays={lic.remainingDays} />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400 font-mono">
                    {lic.boundIp || <span className="text-zinc-600">未绑定</span>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button onClick={() => { setRenewTarget(lic.license); setRenewDays(30) }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-blue-400 hover:bg-blue-400/10">
                      <RefreshCw className="w-3 h-3" />续费
                    </button>
                    <button onClick={() => handleToggle(lic.license, lic.enabled)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs ${lic.enabled ? "text-red-400 hover:bg-red-400/10" : "text-green-400 hover:bg-green-400/10"}`}>
                      {lic.enabled ? <><Ban className="w-3 h-3" />禁用</> : <><RotateCcw className="w-3 h-3" />恢复</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// helper components

function ExpiryBadge({ expiresAt, remainingDays }: { expiresAt: number; remainingDays: number }) {
  if (expiresAt === 0) return <span className="text-zinc-400">永久</span>
  if (remainingDays <= 0) return <span className="text-red-400">已过期</span>
  const color = remainingDays <= 7 ? "text-red-400" : remainingDays <= 30 ? "text-yellow-400" : "text-zinc-400"
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <Clock className="w-3 h-3" />
      {remainingDays} 天
    </span>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}


