import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const BranchNode = memo(function BranchNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const thenCount = d.slotChildren.then?.length ?? 0
  const elseCount = d.slotChildren.else?.length ?? 0

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[260px] border-2 border-orange-600">
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>if</span>
        <Handle type="target" position={Position.Left} id="condition"
          style={{ background: "#f59e0b", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70 ml-1">条件: {String(d.inputs.condition ?? "true")}</span>
      </div>

      <div className="bg-[#1e1e1e] border-b border-white/10">
        <div className="px-2 py-1 text-[10px] text-green-400 uppercase tracking-wider">成立 ({thenCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-green-900/10 border-l-2 border-green-600 ml-2 mr-2 mb-1 rounded-sm">
          {thenCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>

      <div className="bg-[#1e1e1e]">
        <div className="px-2 py-1 text-[10px] text-red-400 uppercase tracking-wider">否则 ({elseCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-red-900/10 border-l-2 border-red-600 ml-2 mr-2 mb-1 rounded-sm">
          {elseCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
