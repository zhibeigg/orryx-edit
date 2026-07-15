import { memo, type DragEvent } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import type { SchemaAction } from "@/types/schema"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const LoopNode = memo(function LoopNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const bodyCount = nodeData.slotChildren.body?.length ?? 0

  const handleBodyDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (nodeData.readOnly) return
    const raw = event.dataTransfer.getData("application/kether-node")
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as SchemaAction | { builtin: string }
      nodeData.onSlotDrop?.("body", payload)
    } catch {
      return
    }
  }

  return (
    <div className={`rounded-xl overflow-hidden min-w-[280px] border-2 border-orange-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(251,146,60,0.35),0_14px_28px_rgba(0,0,0,0.34)]" : "shadow-[0_10px_20px_rgba(0,0,0,0.25)]"}`}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>for</span>
        <input
          type="text"
          value={String(nodeData.inputs.variable ?? "i")}
          disabled={Boolean(nodeData.readOnly)}
          onChange={(event) => nodeData.onInputChange?.("variable", event.target.value, "identifier")}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          className={`${NODE_CONTROL_CLASS} w-14 px-1 py-0.5 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
        />
        <span className="text-[10px] opacity-70">in</span>
        <Handle
          type="target"
          position={Position.Left}
          id="iterable"
          isConnectable={!nodeData.readOnly}
          style={{ background: "#6b7280", width: 8, height: 8, left: -4 }}
        />
        <input
          type="text"
          value={String(nodeData.inputs.iterable ?? "")}
          disabled={Boolean(nodeData.readOnly)}
          onChange={(event) => nodeData.onInputChange?.("iterable", event.target.value)}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          className={`${NODE_CONTROL_CLASS} min-w-0 flex-1 px-1 py-0.5 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
        />
      </div>

      {nodeData.provides && Object.keys(nodeData.provides).length > 0 && (
        <div className="bg-[#252526] px-2 py-0.5 text-[9px] text-green-400 border-b border-white/10">
          可用变量: {Object.keys(nodeData.provides).map((key) => `&${key}`).join(", ")}
        </div>
      )}

      <div className="bg-[#111318]">
        <div className="px-2 py-1 text-[10px] text-orange-400 uppercase tracking-wider">循环体 ({bodyCount})</div>
        <div
          className={`${NODE_CONTROL_CLASS} min-h-[40px] px-2 py-1 bg-orange-900/10 border-l-2 border-orange-600 ml-2 mr-2 mb-1 rounded-sm`}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDrop={handleBodyDrop}
        >
          {bodyCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">{nodeData.readOnly ? "只读" : "拖入节点..."}</div>}
        </div>
      </div>
    </div>
  )
})
