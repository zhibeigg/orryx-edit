import { Wifi, WifiOff, Server, RefreshCw } from "lucide-react"
import { useConnectionStore } from "@/store/connection-store"

export function Header() {
  const { connected, reconnecting, serverName } = useConnectionStore()

  const statusColor = connected ? "text-green-400" : reconnecting ? "text-yellow-400" : "text-red-400"
  const statusText = connected ? "已连接" : reconnecting ? "重连中..." : "未连接"
  const StatusIcon = connected ? Wifi : reconnecting ? RefreshCw : WifiOff

  return (
    <header className="h-[30px] border-b border-border bg-[#3c3c3c] flex items-center justify-between px-2 shrink-0 select-none" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[#cccccc]">Orryx Editor</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {serverName && (
          <div className="flex items-center gap-1 text-[#858585]">
            <Server className="w-3 h-3" />
            <span>{serverName}</span>
          </div>
        )}
        <div className={`flex items-center gap-1 ${statusColor}`}>
          <StatusIcon className={`w-3 h-3 ${reconnecting ? "animate-spin" : ""}`} />
          <span>{statusText}</span>
        </div>
      </div>
    </header>
  )
}
