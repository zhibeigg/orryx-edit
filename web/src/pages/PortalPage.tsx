import { useState, useEffect, useCallback } from "react"
import { Key, MapPin, Clock, Server, LogOut, Unlink } from "lucide-react"

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
      <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
        <div className="card-elevated w-full max-w-sm p-8 space-y-6">
          <div className="text-center space-y-3">
            <Key className="w-12 h-12 mx-auto text-[#007acc]" />
            <h1 className="text-headline-large text-white">Orryx License</h1>
            <p className="text-body-small text-[#858585]">输入 License 查看授权信息</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-label-medium text-[#858585]">License</label>
              <input type="text" value={license} onChange={(e) => setLicense(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="input-filled w-full rounded-sm font-mono text-sm"
                placeholder="输入 License..." />
            </div>
            {error && <p className="text-body-small text-red-400">{error}</p>}
            <button onClick={handleLogin} className="btn btn-filled w-full">查看</button>
          </div>
        </div>
      </div>
    )
  }

  if (!info) return null

  const expiryColor = info.expiresAt === 0 ? "text-[#cccccc]"
    : info.remainingDays <= 0 ? "text-red-400"
    : info.remainingDays <= 7 ? "text-red-400"
    : info.remainingDays <= 30 ? "text-yellow-400"
    : "text-[#cccccc]"

  const expiryText = info.expiresAt === 0 ? "永久有效"
    : info.remainingDays <= 0 ? "已过期"
    : `剩余 ${info.remainingDays} 天 (${new Date(info.expiresAt).toLocaleDateString("zh-CN")} 到期)`

  return (
    <div className="h-screen flex items-center justify-center bg-[#1e1e1e]">
      <div className="card-elevated w-full max-w-md p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-[#3c3c3c] pb-4">
          <div className="flex items-center gap-3">
            <Key className="w-6 h-6 text-[#007acc]" />
            <span className="text-title-large text-white">License 信息</span>
          </div>
          <button onClick={() => { setAuthed(false); sessionStorage.removeItem("portalLicense") }}
            className="btn btn-text flex items-center gap-2 text-[#858585] hover:text-white">
            <LogOut className="w-4 h-4" />退出
          </button>
        </div>

        <div className="space-y-4">
          <div className="card-filled p-4 space-y-3">
            <Row icon={Key} label="License" value={info.license} mono />
            <Row icon={Server} label="状态">
              {info.enabled ? (
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${info.online ? "bg-green-400" : "bg-zinc-600"}`} />
                  <span className="text-body-medium">{info.online ? "在线" : "离线"}</span>
                </span>
              ) : (
                <span className="text-body-medium text-red-400">已禁用</span>
              )}
            </Row>
            <Row icon={Clock} label="有效期">
              <span className={`text-body-medium ${expiryColor}`}>{expiryText}</span>
            </Row>
          </div>

          <div className="card-filled p-4 space-y-3">
            <div className="flex items-center gap-2 text-label-medium text-[#858585]">
              <MapPin className="w-4 h-4" />绑定 IP
            </div>
            {info.boundIps.length > 0 ? (
              <div className="flex items-center justify-between">
                <code className="text-body-medium text-zinc-200 font-mono">{info.boundIps.join(", ")}</code>
                <button onClick={handleUnbindIp} disabled={unbinding}
                  className="btn btn-outlined text-yellow-400 text-xs px-3 py-1.5">
                  <Unlink className="w-3 h-3" />{unbinding ? "解绑中..." : "解绑"}
                </button>
              </div>
            ) : (
              <p className="text-body-small text-[#858585]">未绑定，插件下次连接时将自动绑定服务器 IP</p>
            )}
            <p className="text-label-small text-zinc-600">更换服务器时，先解绑旧 IP，再启动新服务器的插件即可自动绑定。</p>
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
      <div className="flex items-center gap-2 text-label-medium text-[#858585]">
        <Icon className="w-4 h-4" />{label}
      </div>
      {children ?? <span className={`text-body-medium text-zinc-200 ${mono ? "font-mono text-label-medium" : ""}`}>{value}</span>}
    </div>
  )
}
