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
  onlineCount: number
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
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]">
        <div className="w-full max-w-sm mx-4">
          {/* Logo 和标题 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#007acc] to-[#00b4d8] mb-4 shadow-lg shadow-[#007acc]/20">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Orryx Admin</h1>
            <p className="text-[#94a3b8] text-sm">管理后台</p>
          </div>

          {/* 登录卡片 */}
          <div className="bg-[#1e293b]/80 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-[#334155]/50">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#94a3b8]">Admin Key</label>
                <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} 
                  className="w-full px-4 py-3 bg-[#0f172a] border border-[#334155] rounded-xl text-white placeholder-[#475569] focus:outline-none focus:border-[#007acc] focus:ring-1 focus:ring-[#007acc]/30 transition-all text-sm"
                  placeholder="输入管理密钥..." />
              </div>
              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
              <button onClick={handleLogin} 
                className="w-full py-3 bg-gradient-to-r from-[#007acc] to-[#00b4d8] text-white font-medium rounded-xl hover:from-[#0098ff] hover:to-[#22d3ee] transition-all shadow-lg shadow-[#007acc]/20 hover:shadow-[#007acc]/30">
                登录
              </button>
            </div>
          </div>

          {/* 底部信息 */}
          <p className="text-center text-xs text-[#475569] mt-6">
            Orryx Editor · 管理后台
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] text-white">
      <header className="border-b border-[#334155]/50 px-6 py-4 flex items-center justify-between bg-[#1e293b]/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#007acc] to-[#00b4d8] flex items-center justify-center shadow-lg shadow-[#007acc]/20">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold">Orryx Admin</span>
        </div>
        <button onClick={() => { setAuthed(false); sessionStorage.removeItem("adminKey") }} 
          className="flex items-center gap-2 text-[#94a3b8] hover:text-white transition-colors text-sm px-3 py-1.5 rounded-lg hover:bg-[#334155]">
          <span>退出</span>
        </button>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <StatCard icon={Key} label="License 总数" value={stats.licenses} color="blue" />
            <StatCard icon={Server} label="在线服务器" value={stats.servers} color="green" />
            <StatCard icon={Globe} label="在线浏览器" value={stats.browsers} color="purple" />
            <StatCard icon={Users} label="活跃 Token" value={stats.tokens} color="amber" />
          </div>
        )}

        {/* 创建 License */}
        <div className="bg-[#1e293b]/60 backdrop-blur-sm rounded-2xl p-5 border border-[#334155]/50 shadow-xl">
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium text-[#94a3b8]">用户名 / 备注</label>
              <input type="text" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155] rounded-xl text-white placeholder-[#475569] focus:outline-none focus:border-[#007acc] focus:ring-1 focus:ring-[#007acc]/30 transition-all text-sm"
                placeholder="输入用户名或备注..." />
            </div>
            <div className="w-[120px] space-y-2">
              <label className="text-xs font-medium text-[#94a3b8]">有效期</label>
              <Select value={String(newDays)} onValueChange={(v) => setNewDays(Number(v))}>
                <SelectTrigger className="w-full bg-[#0f172a] border-[#334155] rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 天</SelectItem>
                  <SelectItem value="30">30 天</SelectItem>
                  <SelectItem value="90">90 天</SelectItem>
                  <SelectItem value="180">180 天</SelectItem>
                  <SelectItem value="365">365 天</SelectItem>
                  <SelectItem value="0">永久</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <button onClick={handleCreate} disabled={creating || !newOwner.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#007acc] to-[#00b4d8] text-white font-medium rounded-xl hover:from-[#0098ff] hover:to-[#22d3ee] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#007acc]/20">
                <Plus className="w-4 h-4" />创建
              </button>
            </div>
          </div>
        </div>

        {/* 续费弹窗 */}
        <Dialog open={!!renewTarget} onOpenChange={(open) => { if (!open) setRenewTarget(null) }}>
          <DialogContent className="w-80 p-0 bg-[#1e293b] border-[#334155] rounded-2xl">
            <DialogHeader className="px-5 py-4 border-b border-[#334155]">
              <DialogTitle className="text-white">续费 License</DialogTitle>
            </DialogHeader>
            <div className="p-5 space-y-4">
              <p className="text-xs text-[#64748b] font-mono bg-[#0f172a] px-3 py-2 rounded-lg">{renewTarget}</p>
              <div className="flex gap-3">
                <Select value={String(renewDays)} onValueChange={(v) => setRenewDays(Number(v))}>
                  <SelectTrigger className="flex-1 bg-[#0f172a] border-[#334155] rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">+7 天</SelectItem>
                    <SelectItem value="30">+30 天</SelectItem>
                    <SelectItem value="90">+90 天</SelectItem>
                    <SelectItem value="180">+180 天</SelectItem>
                    <SelectItem value="365">+365 天</SelectItem>
                  </SelectContent>
                </Select>
                <button onClick={handleRenew} className="px-4 py-2 bg-gradient-to-r from-[#007acc] to-[#00b4d8] text-white text-sm font-medium rounded-xl hover:from-[#0098ff] hover:to-[#22d3ee] transition-all">确认</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* License 表格 */}
        <div className="bg-[#1e293b]/60 backdrop-blur-sm rounded-2xl overflow-hidden border border-[#334155]/50 shadow-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0f172a]/50 text-[#64748b] text-left">
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
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[#475569]">
                  <div className="flex flex-col items-center gap-2">
                    <Key className="w-8 h-8 opacity-30" />
                    <span>暂无 License</span>
                  </div>
                </td></tr>
              )}
              {licenses.map((lic) => (
                <tr key={lic.license} className="border-t border-[#334155]/30 hover:bg-[#0f172a]/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-[#0f172a] px-2 py-1 rounded font-mono">{lic.license}</code>
                      <button onClick={() => handleCopy(lic.license)} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
                        {copied === lic.license ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#94a3b8]">{lic.owner}</td>
                  <td className="px-4 py-3">
                    {lic.enabled ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className={`w-2 h-2 rounded-full ${lic.online ? "bg-emerald-400" : "bg-[#475569]"}`} />
                        {lic.online ? (
                          <span className="text-[#94a3b8]">在线 <span className="text-[#22d3ee] font-medium">{lic.onlineCount} 子服</span></span>
                        ) : <span className="text-[#64748b]">离线</span>}
                      </span>
                    ) : (
                      <span className="text-xs text-red-400">已禁用</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <ExpiryBadge expiresAt={lic.expiresAt} remainingDays={lic.remainingDays} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[#64748b] font-mono">
                    {lic.boundIps.length > 0 ? lic.boundIps.join(", ") : <span className="text-[#475569]">未绑定</span>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setRenewTarget(lic.license); setRenewDays(30) }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#22d3ee] hover:bg-[#22d3ee]/10 transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />续费
                    </button>
                    <button onClick={() => handleToggle(lic.license, lic.enabled)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${lic.enabled ? "text-red-400 hover:bg-red-400/10" : "text-emerald-400 hover:bg-emerald-400/10"}`}>
                      {lic.enabled ? <><Ban className="w-3.5 h-3.5" />禁用</> : <><RotateCcw className="w-3.5 h-3.5" />恢复</>}
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
  if (expiresAt === 0) return <span className="text-[#64748b]">永久</span>
  if (remainingDays <= 0) return <span className="text-red-400">已过期</span>
  const color = remainingDays <= 7 ? "text-red-400" : remainingDays <= 30 ? "text-amber-400" : "text-[#64748b]"
  return (
    <span className={`flex items-center gap-1.5 ${color}`}>
      <Clock className="w-3.5 h-3.5" />
      {remainingDays} 天
    </span>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Server; label: string; value: number; color: "blue" | "green" | "purple" | "amber" }) {
  const colorMap = {
    blue: "from-[#007acc] to-[#00b4d8]",
    green: "from-[#10b981] to-[#34d399]",
    purple: "from-[#8b5cf6] to-[#a78bfa]",
    amber: "from-[#f59e0b] to-[#fbbf24]",
  }
  return (
    <div className="bg-[#1e293b]/60 backdrop-blur-sm rounded-2xl p-5 border border-[#334155]/50">
      <div className="flex items-center gap-3 text-[#94a3b8] text-sm mb-3">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colorMap[color]} flex items-center justify-center shadow-lg`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        {label}
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  )
}


