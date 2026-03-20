import { useState, useEffect, useRef } from "react"
import type { LogEntry } from "@/types"
import { MSG } from "@/types"
import { useConnectionStore } from "@/store/connection-store"
import { wsClient } from "@/lib/ws-client"
import { cn } from "@/lib/utils"

const LEVEL_COLORS: Record<string, string> = {
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-gray-400",
}

export function LogConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState("")
  const [subscribed, setSubscribed] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = wsClient.on(MSG.LOG_ENTRY, (msg) => {
      const entry = msg.data as unknown as LogEntry
      setLogs((prev) => [...prev.slice(-500), entry])
    })
    return unsub
  }, [])

  // 断线时重置订阅状态
  useEffect(() => {
    const unsub = useConnectionStore.subscribe((state, prevState) => {
      if (prevState.connected && !state.connected) {
        setSubscribed(false)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const toggleSubscribe = () => {
    if (subscribed) {
      wsClient.send(MSG.LOG_UNSUBSCRIBE)
    } else {
      wsClient.send(MSG.LOG_SUBSCRIBE, { filters: filter ? { keyword: filter } : undefined })
    }
    setSubscribed(!subscribed)
  }

  const filteredLogs = filter
    ? logs.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase()) || l.source?.toLowerCase().includes(filter.toLowerCase()))
    : logs

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={toggleSubscribe}
          className={cn(
            "px-3 py-1 text-xs rounded-md",
            subscribed ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
          )}
        >
          {subscribed ? "停止" : "订阅日志"}
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤..."
          className="flex-1 px-2 py-1 text-xs bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => setLogs([])}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          清空
        </button>
        <span className="text-xs text-muted-foreground">{filteredLogs.length} 条</span>
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
        {filteredLogs.map((log, i) => (
          <div key={i} className="flex gap-2 hover:bg-accent/50 px-1 rounded">
            <span className="text-muted-foreground shrink-0">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={cn("shrink-0 w-12", LEVEL_COLORS[log.level] ?? "text-gray-400")}>
              [{log.level}]
            </span>
            {log.source && (
              <span className="text-purple-400 shrink-0">[{log.source}]</span>
            )}
            <span className="text-foreground break-all">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
        {filteredLogs.length === 0 && (
          <div className="text-muted-foreground text-center py-8">
            {subscribed ? "等待日志..." : "点击「订阅日志」开始接收"}
          </div>
        )}
      </div>
    </div>
  )
}
