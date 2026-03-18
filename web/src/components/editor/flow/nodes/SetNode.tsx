import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const SetNode = memo(function SetNode({ data }: NodeProps) {
  const d = data as KetherNodeData

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[180px] border-2 border-green-600">
      <div className="px-3 py-1 bg-green-600 text-[12px] font-medium text-white">set</div>
      <div className="bg-[#1e1e1e] px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-white/70">变量名</span>
          <input type="text" value={String(d.inputs.variable ?? "")}
            onChange={e => { d.inputs.variable = e.target.value }}
            className="flex-1 px-1 py-0.5 bg-black/30 border border-white/10 rounded text-white font-mono" />
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Handle type="target" position={Position.Left} id="value"
            style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
          <span className="text-white/70">值</span>
          <input type="text" value={String(d.inputs.value ?? "")}
            onChange={e => { d.inputs.value = e.target.value }}
            className="flex-1 px-1 py-0.5 bg-black/30 border border-white/10 rounded text-white font-mono" />
        </div>
      </div>
    </div>
  )
})
