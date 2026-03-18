import { useMemo, useState, Suspense, lazy } from "react"
import { parseTimeline, type TimelineEvent } from "@/lib/skill-timeline"
import { Box } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const ColliderPreview = lazy(() =>
  import("./ColliderPreview").then(m => ({ default: m.ColliderPreview }))
)

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
  collider: "bg-amber-400",
  other: "bg-gray-500",
}

const TYPE_LABELS: Record<TimelineEvent["type"], string> = {
  sleep: "等待",
  damage: "伤害",
  animation: "动画",
  launch: "位移",
  flash: "闪现",
  sound: "音效",
  effect: "特效",
  potion: "药水",
  entity: "实体",
  collider: "碰撞箱",
  other: "其他",
}

interface ColliderPreviewState {
  type: "range" | "obb" | "sector"
  params: number[]
  offset?: [number, number, number]
  label: string
  tick: number
}

export function SkillTimeline({ script }: SkillTimelineProps) {
  const events = useMemo(() => parseTimeline(script), [script])
  const [previewCollider, setPreviewCollider] = useState<ColliderPreviewState | null>(null)

  if (events.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        无法解析时间轴事件。请确保 Actions 脚本包含 sleep、damage 等时序动作。
      </div>
    )
  }

  const maxTick = Math.max(...events.map((e) => e.tick + e.duration), 1)
  const tickWidth = Math.max(800 / maxTick, 8)

  // 提取所有带碰撞箱的事件
  const colliderEvents = events.filter(e => e.collider)

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold">技能时间轴</h3>

      {/* 图例 */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${color}`} />
            <span className="text-muted-foreground">{TYPE_LABELS[type as TimelineEvent["type"]]}</span>
          </div>
        ))}
      </div>

      {/* 时间轴 */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${maxTick * tickWidth + 120}px` }}>
          {/* 碰撞箱关键帧轨道 */}
          {colliderEvents.length > 0 && (
            <div className="flex items-center h-8 mb-1">
              <div className="w-[120px] shrink-0 text-xs text-amber-400 truncate pr-2 text-right font-medium flex items-center justify-end gap-1">
                <Box className="w-3 h-3" />
                碰撞箱
              </div>
              <div className="flex-1 relative h-full">
                {/* 轨道背景线 */}
                <div className="absolute top-1/2 left-0 right-0 h-px bg-border" />
                {/* 关键帧菱形标记 */}
                {colliderEvents.map((event, i) => (
                  <button
                    key={i}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 cursor-pointer group z-10"
                    style={{ left: `${event.tick * tickWidth}px` }}
                    onClick={() => setPreviewCollider({
                      type: event.collider!.type,
                      params: event.collider!.params,
                      offset: event.collider!.offset,
                      label: event.label,
                      tick: event.tick,
                    })}
                    title={`${event.label}\n时间: ${event.tick}t\n点击查看 3D 预览`}
                  >
                    {/* 菱形 */}
                    <div className="w-3.5 h-3.5 mx-auto rotate-45 bg-amber-400 group-hover:bg-amber-300 group-hover:scale-125 transition-all border border-amber-600 shadow-sm shadow-amber-400/30" />
                    {/* 悬浮标签 */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block bg-[#252526] text-[#cccccc] text-[10px] px-1.5 py-0.5 shadow-lg whitespace-nowrap border border-[#3c3c3c] z-50 pointer-events-none">
                      {event.label} @{event.tick}t
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

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
            {events.filter(e => e.type !== "collider").map((event, i) => (
              <div key={i} className="flex items-center h-7 group">
                <div className="w-[120px] shrink-0 text-xs text-muted-foreground truncate pr-2 text-right">
                  {event.label}
                </div>
                <div className="flex-1 relative h-full">
                  <div
                    className={`absolute h-5 top-1 rounded-sm ${TYPE_COLORS[event.type]} opacity-80 hover:opacity-100 transition-opacity ${event.collider ? "cursor-pointer ring-1 ring-amber-400/50" : ""}`}
                    style={{
                      left: `${event.tick * tickWidth}px`,
                      width: `${Math.max(event.duration * tickWidth, 4)}px`,
                    }}
                    title={`${event.label}\n时间: ${event.tick}t\n持续: ${event.duration}t\n${event.raw}`}
                    onClick={() => {
                      if (event.collider) {
                        setPreviewCollider({
                          type: event.collider.type,
                          params: event.collider.params,
                          offset: event.collider.offset,
                          label: event.label,
                          tick: event.tick,
                        })
                      }
                    }}
                  >
                    {/* 碰撞箱标记角标 */}
                    {event.collider && (
                      <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rotate-45 bg-amber-400 border border-amber-600" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 总时长 */}
      <div className="text-xs text-muted-foreground">
        总时长: {maxTick} ticks ({(maxTick / 20).toFixed(1)}s)
        {colliderEvents.length > 0 && (
          <span className="ml-3 text-amber-400">
            {colliderEvents.length} 个碰撞箱关键帧
          </span>
        )}
      </div>

      {/* 碰撞箱 3D 预览弹窗 */}
      <Dialog open={!!previewCollider} onOpenChange={(open) => { if (!open) setPreviewCollider(null) }}>
        <DialogContent className="w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col p-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Box className="w-3.5 h-3.5 text-amber-400" />
              {previewCollider?.label}
              <span className="text-[11px] text-[#858585] font-normal">@{previewCollider?.tick}t</span>
            </DialogTitle>
          </DialogHeader>
          <div className="h-[400px]">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-[13px] text-[#858585]">加载 3D 预览...</div>}>
              {previewCollider && <ColliderPreview type={previewCollider.type} params={previewCollider.params} offset={previewCollider.offset} />}
            </Suspense>
          </div>
          <div className="px-3 py-1.5 border-t border-[#3c3c3c] text-[11px] text-[#858585] shrink-0">
            鼠标拖拽旋转，滚轮缩放。黄色线框为玩家参考位置。
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
