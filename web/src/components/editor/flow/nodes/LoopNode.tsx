import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const LoopNode = memo(function LoopNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const bodyCount = d.slotChildren.body?.length ?? 0

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[260px] border-2 border-orange-600">
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>for</span>
        <input type="text" value={String(d.inputs.variable ?? "i")}
          onChange={e => { d.inputs.variable = e.target.value }}
          className="w-12 px-1 py-0 text-[11px] bg-black/30 border border-white/10 rounded text-white font-mono" />
        <span className="text-[10px] opacity-70">in</span>
        <Handle type="target" position={Position.Left} id="iterable"
          style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70">{String(d.inputs.iterable ?? "")}</span>
      </div>

      {d.provides && Object.keys(d.provides).length > 0 && (
        <div className="bg-[#252526] px-2 py-0.5 text-[9px] text-green-400 border-b border-white/10">
          可用变量: {Object.keys(d.provides).map(k => `&${k}`).join(", ")}
        </div>
      )}

      <div className="bg-[#1e1e1e]">
        <div className="px-2 py-1 text-[10px] text-orange-400 uppercase tracking-wider">循环体 ({bodyCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-orange-900/10 border-l-2 border-orange-600 ml-2 mr-2 mb-1 rounded-sm">
          {bodyCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
