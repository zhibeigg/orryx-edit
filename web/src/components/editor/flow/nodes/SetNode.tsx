import { memo, useCallback } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const SetNode = memo(function SetNode({ id, data, selected }: NodeProps) {
  const d = data as KetherNodeData
  const { updateNodeData } = useReactFlow()

  const updateInput = useCallback((key: string, value: string) => {
    d.onInlineEdit?.()
    updateNodeData(id, { inputs: { ...d.inputs, [key]: value } })
  }, [id, d, updateNodeData])

  return (
    <div className={`rounded-xl overflow-hidden min-w-[190px] border-2 border-green-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(74,222,128,0.35),0_12px_24px_rgba(0,0,0,0.32)]" : "shadow-[0_8px_16px_rgba(0,0,0,0.24)]"}`}>
      <div className="px-3 py-1 bg-green-600 text-[12px] font-medium text-white">set</div>
      <div className="bg-[#111318] px-2.5 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-white/70">变量名</span>
          <input type="text" value={String(d.inputs.variable ?? "")}
            onChange={e => updateInput("variable", e.target.value)}
            className="flex-1 px-1.5 py-1 bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/70" />
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Handle type="target" position={Position.Left} id="value"
            style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
          <span className="text-white/70">值</span>
          <input type="text" value={String(d.inputs.value ?? "")}
            onChange={e => updateInput("value", e.target.value)}
            className="flex-1 px-1.5 py-1 bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/70" />
        </div>
      </div>
    </div>
  )
})
