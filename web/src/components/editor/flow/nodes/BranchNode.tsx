import { memo, type DragEvent } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import type { SchemaAction } from "@/types/schema"

export const BranchNode = memo(function BranchNode({ data, selected }: NodeProps) {
  const d = data as KetherNodeData
  const thenCount = d.slotChildren.then?.length ?? 0
  const elseCount = d.slotChildren.else?.length ?? 0

  const handleSlotDrop = (event: DragEvent, slot: "then" | "else") => {
    event.preventDefault()
    const raw = event.dataTransfer.getData("application/kether-node")
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as SchemaAction | { builtin: string }
      d.onSlotDrop?.(slot, payload)
    } catch {
      return
    }
  }

  return (
    <div className={`rounded-xl overflow-hidden min-w-[280px] border-2 border-orange-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(251,191,36,0.35),0_14px_28px_rgba(0,0,0,0.34)]" : "shadow-[0_10px_20px_rgba(0,0,0,0.25)]"}`}>
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>if</span>
        <Handle type="target" position={Position.Left} id="condition"
          style={{ background: "#f59e0b", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70 ml-1">条件: {String(d.inputs.condition ?? "true")}</span>
      </div>

      <div className="bg-[#111318] border-b border-white/10">
        <div className="px-2 py-1 text-[10px] text-green-400 uppercase tracking-wider">成立 ({thenCount})</div>
        <div
          className="min-h-[40px] px-2 py-1 bg-green-900/10 border-l-2 border-green-600 ml-2 mr-2 mb-1 rounded-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleSlotDrop(event, "then")}
        >
          {thenCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>

      <div className="bg-[#111318]">
        <div className="px-2 py-1 text-[10px] text-red-400 uppercase tracking-wider">否则 ({elseCount})</div>
        <div
          className="min-h-[40px] px-2 py-1 bg-red-900/10 border-l-2 border-red-600 ml-2 mr-2 mb-1 rounded-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleSlotDrop(event, "else")}
        >
          {elseCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
