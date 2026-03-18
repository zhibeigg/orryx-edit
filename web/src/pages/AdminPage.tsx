import { useState, useEffect, useCallback } from "react"
import { Shield, Plus, Copy, Check, Ban, RotateCcw, Server, Users, Key, Globe, Clock, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

interface License {
  license: string
  owner: string
  serverKey: string
  enabled: boolean
  online: boolean
  createdAt: number
  expiresAt: number
  boundIps: string[]
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
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="w-full max-w-sm p-8 space-y-6">
          <div className="text-center space-y-2">
            <Shield className="w-10 h-10 mx-auto text-[#858585]" />
            <h1 className="text-2xl font-bold text-white">Orryx Admin</h1>
          </div>
          <div className="space-y-3">
            <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Admin Key"
              className="w-full px-4 py-3 rounded-sm bg-[#252526] border border-[#3c3c3c] text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600" />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button onClick={handleLogin} className="w-full py-3 rounded-sm bg-[#007acc] text-white font-medium hover:bg-[#0098ff]">登录</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-white">
      <header className="border-b border-[#3c3c3c] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#858585]" />
          <span className="font-bold text-lg">Orryx Admin</span>
        </div>
        <button onClick={() => { setAuthed(false); sessionStorage.removeItem("adminKey") }} className="text-sm text-[#858585] hover:text-[#cccccc]">退出</button>
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
            className="flex-1 px-4 py-2.5 rounded-sm bg-[#252526] border border-[#3c3c3c] text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600" />
          <Select value={String(newDays)} onValueChange={(v) => setNewDays(Number(v))}>
            <SelectTrigger className="w-[100px] py-2.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 天</SelectItem>
              <SelectItem value="30">30 天</SelectItem>
              <SelectItem value="90">90 天</SelectItem>
              <SelectItem value="180">180 天</SelectItem>
              <SelectItem value="365">365 天</SelectItem>
              <SelectItem value="0">永久</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={handleCreate} disabled={creating || !newOwner.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-sm bg-[#007acc] text-white font-medium hover:bg-[#0098ff] disabled:opacity-40">
            <Plus className="w-4 h-4" />创建
          </button>
        </div>

        {/* 续费弹窗 */}
        <Dialog open={!!renewTarget} onOpenChange={(open) => { if (!open) setRenewTarget(null) }}>
          <DialogContent className="w-80 p-0">
            <DialogHeader>
              <DialogTitle>续费 License</DialogTitle>
            </DialogHeader>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-[#858585] font-mono">{renewTarget}</p>
              <div className="flex gap-2">
                <Select value={String(renewDays)} onValueChange={(v) => setRenewDays(Number(v))}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">+7 天</SelectItem>
                    <SelectItem value="30">+30 天</SelectItem>
                    <SelectItem value="90">+90 天</SelectItem>
                    <SelectItem value="180">+180 天</SelectItem>
                    <SelectItem value="365">+365 天</SelectItem>
                  </SelectContent>
                </Select>
                <button onClick={handleRenew} className="px-4 py-1.5 bg-[#007acc] text-white text-[13px] hover:bg-[#0098ff]">确认</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* License 表格 */}
        <div className="rounded-sm border border-[#3c3c3c] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#252526] text-[#858585] text-left">
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
                <tr key={lic.license} className="border-t border-[#3c3c3c]/50 hover:bg-[#252526]/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-[#252526] px-2 py-1 rounded font-mono">{lic.license}</code>
                      <button onClick={() => handleCopy(lic.license)} className="text-zinc-600 hover:text-[#cccccc]">
                        {copied === lic.license ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#cccccc]">{lic.owner}</td>
                  <td className="px-4 py-3">
                    {lic.enabled ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-sm ${lic.online ? "bg-green-400" : "bg-zinc-600"}`} />
                        {lic.online ? "在线" : "离线"}
                      </span>
                    ) : (
                      <span className="text-xs text-red-400">已禁用</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <ExpiryBadge expiresAt={lic.expiresAt} remainingDays={lic.remainingDays} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[#858585] font-mono">
                    {lic.boundIps.length > 0 ? lic.boundIps.join(", ") : <span className="text-zinc-600">未绑定</span>}
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
  if (expiresAt === 0) return <span className="text-[#858585]">永久</span>
  if (remainingDays <= 0) return <span className="text-red-400">已过期</span>
  const color = remainingDays <= 7 ? "text-red-400" : remainingDays <= 30 ? "text-yellow-400" : "text-[#858585]"
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <Clock className="w-3 h-3" />
      {remainingDays} 天
    </span>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[#3c3c3c] bg-[#252526]/30 p-4">
      <div className="flex items-center gap-2 text-[#858585] text-xs mb-1"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}


