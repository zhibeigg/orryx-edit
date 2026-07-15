import { memo, type DragEvent } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData, KetherSlotLayout } from "../flow-types"
import { useSchema } from "../SchemaContext"
import { getPortColor } from "./node-styles"
import { NODE_CONTROL_CLASS, stopNodeInteraction, useNodeInternalsSync } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

interface SlotZoneProps {
  slot: "then" | "else"
  label: string
  count: number
  layout: KetherSlotLayout
  disabled: boolean
  onDrop: KetherNodeData["onSlotDrop"]
}

function SlotZone({ slot, label, count, layout, disabled, onDrop }: SlotZoneProps) {
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/kether-node"))
      onDrop?.(slot, payload)
    } catch {
      // 忽略非节点拖拽数据。
    }
  }

  return (
    <div
      className={`absolute overflow-visible rounded border ${slot === "then" ? "border-emerald-700/60 bg-emerald-950/20" : "border-rose-700/60 bg-rose-950/20"}`}
      style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault()
      }}
      onDrop={handleDrop}
    >
      <Handle
        type="source"
        position={Position.Top}
        id={`${slot}-out`}
        isConnectable={!disabled}
        title={`${label} 分支入口`}
        style={{
          background: slot === "then" ? "#34d399" : "#fb7185",
          border: "2px solid #111318",
          width: 10,
          height: 10,
          top: -5,
          left: 28,
          zIndex: 8,
        }}
      />
      <div className="flex h-7 items-center justify-between gap-3 border-b border-white/10 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/74">
        <span>{label}</span>
        <span className="font-mono text-[9px] font-normal text-white/38">{count}</span>
      </div>
      {count === 0 && (
        <div className="flex h-[calc(100%-1.75rem)] min-h-10 items-center justify-center px-3 text-center text-[10px] text-white/30">
          {disabled ? "空分支" : "拖入节点"}
        </div>
      )}
    </div>
  )
}

export const BranchNode = memo(function BranchNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const layout = nodeData.layout
  const width = layout?.width ?? 380
  const height = layout?.height ?? 292
  const headerHeight = layout?.headerHeight ?? 76
  const thenLayout = layout?.slots?.then ?? {
    x: 12,
    y: headerHeight + 10,
    width: width - 24,
    height: 88,
    contentX: 12,
    contentY: headerHeight + 38,
    contentWidth: width - 24,
    contentHeight: 60,
  }
  const elseLayout = layout?.slots?.else ?? {
    x: 12,
    y: thenLayout.y + thenLayout.height + 10,
    width: width - 24,
    height: 88,
    contentX: 12,
    contentY: thenLayout.y + thenLayout.height + 38,
    contentWidth: width - 24,
    contentHeight: 60,
  }
  const thenCount = nodeData.slotChildren.then?.length ?? 0
  const elseCount = nodeData.slotChildren.else?.length ?? 0
  useNodeInternalsSync(id, `condition|then:${thenCount}|else:${elseCount}|${width}x${height}`)

  return (
    <div className="relative overflow-visible" style={{ width, height }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className={`absolute inset-0 rounded-md border bg-[#111318] transition-shadow duration-150 ${selected ? "border-orange-300 shadow-[0_0_0_2px_rgba(251,146,60,0.24),0_16px_32px_rgba(0,0,0,0.34)]" : "border-orange-800/90 shadow-[0_12px_26px_rgba(0,0,0,0.28)]"}`}>
        <div className="absolute inset-x-0 top-0 rounded-t-[5px] border-b border-orange-700/40 bg-orange-950/80 px-3 py-2" style={{ height: headerHeight }}>
          <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-orange-50">
            <span>条件分支</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-orange-200/55">if</span>
          </div>
          <div className="relative mt-2 flex min-h-7 items-center justify-between gap-3 rounded border border-white/10 bg-black/20 px-2 text-[10px] text-white/68">
            <Handle
              type="target"
              position={Position.Left}
              id="condition"
              isConnectable={!nodeData.readOnly}
              title="分支条件输入"
              style={{
                background: schema ? getPortColor("boolean", schema) : "#f97316",
                border: "2px solid #111318",
                width: 10,
                height: 10,
                left: -14,
                top: "50%",
                zIndex: 8,
              }}
            />
            <span className="shrink-0">条件</span>
            <input
              type="text"
              value={String(nodeData.inputs.condition ?? "true")}
              disabled={Boolean(nodeData.readOnly)}
              onChange={(event) => nodeData.onInputChange?.("condition", event.target.value)}
              onPointerDown={stopNodeInteraction}
              onWheel={stopNodeInteraction}
              className={`${NODE_CONTROL_CLASS} min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-white focus:outline-none focus:ring-1 focus:ring-orange-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            />
          </div>
        </div>

        <SlotZone
          slot="then"
          label="成立"
          count={thenCount}
          layout={thenLayout}
          disabled={Boolean(nodeData.readOnly)}
          onDrop={nodeData.onSlotDrop}
        />
        <SlotZone
          slot="else"
          label="否则"
          count={elseCount}
          layout={elseLayout}
          disabled={Boolean(nodeData.readOnly)}
          onDrop={nodeData.onSlotDrop}
        />
      </div>
    </div>
  )
})
