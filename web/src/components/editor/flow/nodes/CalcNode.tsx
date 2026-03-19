import { memo, useCallback } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const CalcNode = memo(function CalcNode({ id, data }: NodeProps) {
  const d = data as KetherNodeData
  const { updateNodeData } = useReactFlow()

  const updateFormula = useCallback((value: string) => {
    updateNodeData(id, { inputs: { ...d.inputs, formula: value } })
  }, [id, d.inputs, updateNodeData])

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[180px] border-2 border-cyan-600">
      <div className="px-3 py-1 bg-cyan-600 text-[12px] font-medium text-white">calc</div>
      <div className="bg-[#1e1e1e] px-2 py-1.5">
        <input type="text" value={String(d.inputs.formula ?? "")}
          onChange={e => updateFormula(e.target.value)}
          className="w-full px-1.5 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white font-mono"
          placeholder="表达式..." />
      </div>
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#06b6d4", width: 8, height: 8, right: -4 }} />
    </div>
  )
})
