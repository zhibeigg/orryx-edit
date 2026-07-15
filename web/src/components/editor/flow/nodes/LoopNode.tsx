import { memo, type DragEvent } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData, KetherSlotLayout } from "../flow-types"
import { useSchema } from "../SchemaContext"
import { getPortColor } from "./node-styles"
import {
  NODE_CONTROL_CLASS,
  NODE_PORT_EDGE_OFFSET_PX,
  NODE_PORT_SIZE_PX,
  stopNodeInteraction,
  useNodeInternalsSync,
} from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

function BodyZone({
  layout,
  count,
  disabled,
  onDrop,
}: {
  layout: KetherSlotLayout
  count: number
  disabled: boolean
  onDrop: KetherNodeData["onSlotDrop"]
}) {
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/kether-node"))
      onDrop?.("body", payload)
    } catch {
      // 忽略非节点拖拽数据。
    }
  }

  return (
    <div
      className="absolute overflow-visible rounded border border-amber-700/60 bg-amber-950/20"
      style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault()
      }}
      onDrop={handleDrop}
    >
      <Handle
        type="source"
        position={Position.Top}
        id="body-out"
        isConnectable={!disabled}
        title="循环体入口"
        style={{
          background: "#fbbf24",
          border: "2px solid #111318",
          width: NODE_PORT_SIZE_PX,
          height: NODE_PORT_SIZE_PX,
          top: NODE_PORT_EDGE_OFFSET_PX,
          left: 34,
          zIndex: 8,
        }}
      />
      <div className="flex h-9 items-center justify-between gap-4 border-b border-white/10 px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/74">
        <span>循环体</span>
        <span className="font-mono text-[11px] font-normal text-white/38">{count}</span>
      </div>
      {count === 0 && (
        <div className="flex h-[calc(100%-2.25rem)] min-h-12 items-center justify-center px-4 text-center text-[12px] text-white/30">
          {disabled ? "空循环体" : "拖入节点"}
        </div>
      )}
    </div>
  )
}

export const LoopNode = memo(function LoopNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const layout = nodeData.layout
  const width = layout?.width ?? 456
  const height = layout?.height ?? 264
  const headerHeight = layout?.headerHeight ?? 96
  const bodyLayout = layout?.slots?.body ?? {
    x: 16,
    y: headerHeight + 12,
    width: width - 32,
    height: height - headerHeight - 28,
    contentX: 16,
    contentY: headerHeight + 48,
    contentWidth: width - 32,
    contentHeight: height - headerHeight - 64,
  }
  const bodyCount = nodeData.slotChildren.body?.length ?? 0
  const iterableType = String(nodeData.inputKinds.iterable ?? "any")
  useNodeInternalsSync(id, `iterable:${iterableType}|body:${bodyCount}|${width}x${height}`)

  return (
    <div className="relative overflow-visible" style={{ width, height }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className={`absolute inset-0 rounded-md border bg-[#111318] transition-shadow duration-150 ${selected ? "border-amber-300 shadow-[0_0_0_2px_rgba(251,191,36,0.24),0_16px_32px_rgba(0,0,0,0.34)]" : "border-amber-800/90 shadow-[0_12px_26px_rgba(0,0,0,0.28)]"}`}>
        <div className="absolute inset-x-0 top-0 rounded-t-[5px] border-b border-amber-700/40 bg-amber-950/80 px-4 py-3" style={{ height: headerHeight }}>
          <div className="flex items-center justify-between gap-4 text-[14px] font-semibold text-amber-50">
            <span>循环</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber-200/55">for</span>
          </div>
          <div className="relative mt-3 flex min-h-10 items-center justify-between gap-3 rounded border border-white/10 bg-black/20 px-3 text-[12px] text-white/68">
            <Handle
              type="target"
              position={Position.Left}
              id="iterable"
              isConnectable={!nodeData.readOnly}
              title="循环迭代输入"
              style={{
                background: schema ? getPortColor(iterableType, schema) : "#fbbf24",
                border: "2px solid #111318",
                width: NODE_PORT_SIZE_PX,
                height: NODE_PORT_SIZE_PX,
                left: -17,
                top: "50%",
                zIndex: 8,
              }}
            />
            <span className="shrink-0">for</span>
            <input
              type="text"
              value={String(nodeData.inputs.variable ?? "i")}
              disabled={Boolean(nodeData.readOnly)}
              onChange={(event) => nodeData.onInputChange?.("variable", event.target.value, "identifier")}
              onPointerDown={stopNodeInteraction}
              onWheel={stopNodeInteraction}
              className={`${NODE_CONTROL_CLASS} min-h-9 w-20 shrink-0 rounded border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            />
            <span className="shrink-0 text-white/40">in</span>
            <input
              type="text"
              value={String(nodeData.inputs.iterable ?? "")}
              disabled={Boolean(nodeData.readOnly)}
              onChange={(event) => nodeData.onInputChange?.("iterable", event.target.value)}
              onPointerDown={stopNodeInteraction}
              onWheel={stopNodeInteraction}
              className={`${NODE_CONTROL_CLASS} min-h-9 min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-3 py-2 font-mono text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            />
          </div>
        </div>

        <BodyZone
          layout={bodyLayout}
          count={bodyCount}
          disabled={Boolean(nodeData.readOnly)}
          onDrop={nodeData.onSlotDrop}
        />
      </div>
    </div>
  )
})
