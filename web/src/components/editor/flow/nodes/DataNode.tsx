import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { BUILTIN_COLORS } from "./node-styles"

export const DataNode = memo(function DataNode({ data, selected }: NodeProps) {
  const d = data as KetherNodeData
  const color = BUILTIN_COLORS[d.astRef?.type ?? "data"] ?? "#6366f1"

  return (
    <div className={`rounded-md px-3 py-1.5 text-[12px] font-mono text-white min-w-[72px] text-center transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(199,210,254,0.5),0_10px_24px_rgba(0,0,0,0.3)]" : "shadow-[0_6px_14px_rgba(0,0,0,0.22)]"}`}
      style={{ backgroundColor: color, border: `1px solid ${color}` }}>
      {d.label}
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#fff", width: 6, height: 6, right: -3 }} />
    </div>
  )
})
