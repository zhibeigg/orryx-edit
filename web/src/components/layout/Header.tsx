import { Wifi, WifiOff, Server, RefreshCw } from "lucide-react"
import { useConnectionStore } from "@/store/connection-store"

export function Header() {
  const { connected, reconnecting, serverName } = useConnectionStore()

  const statusColor = connected ? "text-green-500" : reconnecting ? "text-yellow-500" : "text-red-400"
  const statusText = connected ? "已连接" : reconnecting ? "重连中..." : "未连接"
  const StatusIcon = connected ? Wifi : reconnecting ? RefreshCw : WifiOff

  return (
    <header className="h-12 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tracking-tight">Orryx Editor</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {serverName && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Server className="w-3.5 h-3.5" />
            <span>{serverName}</span>
          </div>
        )}
        <div className={`flex items-center gap-1 ${statusColor}`}>
          <StatusIcon className={`w-4 h-4 ${reconnecting ? "animate-spin" : ""}`} />
          <span>{statusText}</span>
        </div>
      </div>
    </header>
  )
}
