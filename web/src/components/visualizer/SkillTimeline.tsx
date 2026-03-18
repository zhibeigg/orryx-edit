import { useMemo } from "react"
import { parseTimeline, type TimelineEvent } from "@/lib/skill-timeline"

interface SkillTimelineProps {
  script: string
}

const TYPE_COLORS: Record<TimelineEvent["type"], string> = {
  sleep: "bg-gray-600",
  damage: "bg-red-500",
  animation: "bg-blue-500",
  launch: "bg-green-500",
  flash: "bg-yellow-500",
  sound: "bg-purple-500",
  effect: "bg-pink-500",
  potion: "bg-cyan-500",
  entity: "bg-orange-500",
  other: "bg-gray-500",
}

export function SkillTimeline({ script }: SkillTimelineProps) {
  const events = useMemo(() => parseTimeline(script), [script])

  if (events.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        无法解析时间轴事件。请确保 Actions 脚本包含 sleep、damage 等时序动作。
      </div>
    )
  }

  const maxTick = Math.max(...events.map((e) => e.tick + e.duration), 1)
  const tickWidth = Math.max(800 / maxTick, 8)

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold">技能时间轴</h3>

      {/* 图例 */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${color}`} />
            <span className="text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>

      {/* 时间轴 */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${maxTick * tickWidth + 120}px` }}>
          {/* 刻度尺 */}
          <div className="relative h-6 mb-1 ml-[120px]">
            {Array.from({ length: Math.ceil(maxTick / 5) + 1 }, (_, i) => i * 5).map((tick) => (
              <div
                key={tick}
                className="text-xs text-muted-foreground absolute"
                style={{ left: `${tick * tickWidth}px` }}
              >
                {tick}t
              </div>
            ))}
          </div>

          {/* 事件行 */}
          <div className="space-y-1 relative">
            {events.map((event, i) => (
              <div key={i} className="flex items-center h-7 group">
                <div className="w-[120px] shrink-0 text-xs text-muted-foreground truncate pr-2 text-right">
                  {event.label}
                </div>
                <div className="flex-1 relative h-full">
                  <div
                    className={`absolute h-5 top-1 rounded-sm ${TYPE_COLORS[event.type]} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                    style={{
                      left: `${event.tick * tickWidth}px`,
                      width: `${Math.max(event.duration * tickWidth, 4)}px`,
                    }}
                    title={`${event.label}\n时间: ${event.tick}t\n持续: ${event.duration}t\n${event.raw}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 总时长 */}
      <div className="text-xs text-muted-foreground">
        总时长: {maxTick} ticks ({(maxTick / 20).toFixed(1)}s)
      </div>
    </div>
  )
}
