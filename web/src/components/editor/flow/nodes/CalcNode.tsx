import { memo, useCallback } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const CalcNode = memo(function CalcNode({ id, data, selected }: NodeProps) {
  const d = data as KetherNodeData
  const { updateNodeData } = useReactFlow()

  const updateFormula = useCallback((value: string) => {
    d.onInlineEdit?.()
    updateNodeData(id, { inputs: { ...d.inputs, formula: value } })
  }, [id, d, updateNodeData])

  return (
    <div className={`rounded-xl overflow-hidden min-w-[190px] border-2 border-cyan-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(34,211,238,0.35),0_12px_24px_rgba(0,0,0,0.32)]" : "shadow-[0_8px_16px_rgba(0,0,0,0.24)]"}`}>
      <div className="px-3 py-1 bg-cyan-600 text-[12px] font-medium text-white">calc</div>
      <div className="bg-[#111318] px-2 py-2">
        <input type="text" value={String(d.inputs.formula ?? "")}
          onChange={e => updateFormula(e.target.value)}
          className="w-full px-1.5 py-1 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400/70"
          placeholder="表达式..." />
      </div>
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#06b6d4", width: 8, height: 8, right: -4 }} />
    </div>
  )
})
