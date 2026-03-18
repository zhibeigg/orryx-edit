import { useState, useEffect, useCallback } from "react"
import { Key, MapPin, Clock, Server, LogOut, Unlink } from "lucide-react"

interface LicenseInfo {
  license: string
  owner: string
  enabled: boolean
  online: boolean
  expiresAt: number
  boundIp: string
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

  const load = useCallback(async () => {
    try {
      const res = await licenseApi(license, "/info")
      if (!res.ok) { setError("License 无效"); setAuthed(false); return }
      setInfo(await res.json())
      setError(null)
      setAuthed(true)
      sessionStorage.setItem("portalLicense", license)
    } catch { setError("连接失败") }
  }, [license])

  const handleLogin = async () => { if (license.trim()) await load() }
  useEffect(() => { if (license) handleLogin() }, []) // eslint-disable-line

  const handleUnbindIp = async () => {
    setUnbinding(true)
    try {
      await licenseApi(license, "/ip", "DELETE")
      await load()
    } finally { setUnbinding(false) }
  }

  if (!authed) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0e14]">
        <div className="w-full max-w-sm p-8 space-y-6">
          <div className="text-center space-y-2">
            <Key className="w-10 h-10 mx-auto text-zinc-400" />
            <h1 className="text-2xl font-bold text-zinc-100">Orryx License</h1>
            <p className="text-sm text-zinc-500">输入 License 查看授权信息</p>
          </div>
          <div className="space-y-3">
            <input type="text" value={license} onChange={(e) => setLicense(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="输入 License..."
              className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600 font-mono text-sm" />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button onClick={handleLogin} className="w-full py-3 rounded-lg bg-zinc-100 text-zinc-900 font-medium hover:bg-zinc-200">查看</button>
          </div>
        </div>
      </div>
    )
  }

  if (!info) return null

  const expiryColor = info.expiresAt === 0 ? "text-zinc-300"
    : info.remainingDays <= 0 ? "text-red-400"
    : info.remainingDays <= 7 ? "text-red-400"
    : info.remainingDays <= 30 ? "text-yellow-400"
    : "text-zinc-300"

  const expiryText = info.expiresAt === 0 ? "永久有效"
    : info.remainingDays <= 0 ? "已过期"
    : `剩余 ${info.remainingDays} 天 (${new Date(info.expiresAt).toLocaleDateString("zh-CN")} 到期)`

  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0e14]">
      <div className="w-full max-w-md p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-zinc-400" />
            <span className="font-bold text-lg text-zinc-100">License 信息</span>
          </div>
          <button onClick={() => { setAuthed(false); sessionStorage.removeItem("portalLicense") }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            <LogOut className="w-3.5 h-3.5" />退出
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
            <Row icon={Key} label="License" value={info.license} mono />
            <Row icon={Server} label="状态">
              {info.enabled ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <span className={`w-2 h-2 rounded-full ${info.online ? "bg-green-400" : "bg-zinc-600"}`} />
                  {info.online ? "在线" : "离线"}
                </span>
              ) : (
                <span className="text-red-400 text-sm">已禁用</span>
              )}
            </Row>
            <Row icon={Clock} label="有效期">
              <span className={`text-sm ${expiryColor}`}>{expiryText}</span>
            </Row>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <MapPin className="w-3.5 h-3.5" />绑定 IP
            </div>
            {info.boundIp ? (
              <div className="flex items-center justify-between">
                <code className="text-sm text-zinc-200 font-mono">{info.boundIp}</code>
                <button onClick={handleUnbindIp} disabled={unbinding}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-yellow-400 hover:bg-yellow-400/10 disabled:opacity-40">
                  <Unlink className="w-3 h-3" />{unbinding ? "解绑中..." : "解绑"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">未绑定，插件下次连接时将自动绑定服务器 IP</p>
            )}
            <p className="text-xs text-zinc-600">更换服务器时，先解绑旧 IP，再启动新服务器的插件即可自动绑定。</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value, mono, children }: {
  icon: typeof Key; label: string; value?: string; mono?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-zinc-400 text-xs"><Icon className="w-3.5 h-3.5" />{label}</div>
      {children ?? <span className={`text-sm text-zinc-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>}
    </div>
  )
}
