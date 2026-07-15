import { memo, type DragEvent } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import type { SchemaAction } from "@/types/schema"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const BranchNode = memo(function BranchNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const thenCount = nodeData.slotChildren.then?.length ?? 0
  const elseCount = nodeData.slotChildren.else?.length ?? 0

  const handleSlotDrop = (event: DragEvent, slot: "then" | "else") => {
    event.preventDefault()
    event.stopPropagation()
    if (nodeData.readOnly) return
    const raw = event.dataTransfer.getData("application/kether-node")
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as SchemaAction | { builtin: string }
      nodeData.onSlotDrop?.(slot, payload)
    } catch {
      return
    }
  }

  return (
    <div className={`rounded-xl overflow-hidden min-w-[280px] border-2 border-orange-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(251,191,36,0.35),0_14px_28px_rgba(0,0,0,0.34)]" : "shadow-[0_10px_20px_rgba(0,0,0,0.25)]"}`}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>if</span>
        <Handle
          type="target"
          position={Position.Left}
          id="condition"
          isConnectable={!nodeData.readOnly}
          style={{ background: "#f59e0b", width: 8, height: 8, left: -4 }}
        />
        <span className="text-[10px] opacity-70 ml-1">条件</span>
        <input
          type="text"
          value={String(nodeData.inputs.condition ?? "")}
          disabled={Boolean(nodeData.readOnly)}
          onChange={(event) => nodeData.onInputChange?.("condition", event.target.value)}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          className={`${NODE_CONTROL_CLASS} min-w-0 flex-1 px-1 py-0.5 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
        />
      </div>

      <div className="bg-[#111318] border-b border-white/10">
        <div className="px-2 py-1 text-[10px] text-green-400 uppercase tracking-wider">成立 ({thenCount})</div>
        <div
          className={`${NODE_CONTROL_CLASS} min-h-[40px] px-2 py-1 bg-green-900/10 border-l-2 border-green-600 ml-2 mr-2 mb-1 rounded-sm`}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDrop={(event) => handleSlotDrop(event, "then")}
        >
          {thenCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">{nodeData.readOnly ? "只读" : "拖入节点..."}</div>}
        </div>
      </div>

      <div className="bg-[#111318]">
        <div className="px-2 py-1 text-[10px] text-red-400 uppercase tracking-wider">否则 ({elseCount})</div>
        <div
          className={`${NODE_CONTROL_CLASS} min-h-[40px] px-2 py-1 bg-red-900/10 border-l-2 border-red-600 ml-2 mr-2 mb-1 rounded-sm`}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDrop={(event) => handleSlotDrop(event, "else")}
        >
          {elseCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">{nodeData.readOnly ? "只读" : "拖入节点..."}</div>}
        </div>
      </div>
    </div>
  )
})
