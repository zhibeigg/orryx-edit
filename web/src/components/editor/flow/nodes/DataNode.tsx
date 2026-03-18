import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { BUILTIN_COLORS } from "./node-styles"

export const DataNode = memo(function DataNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const color = BUILTIN_COLORS[d.astRef?.type ?? "data"] ?? "#6366f1"

  return (
    <div className="rounded px-3 py-1 text-[12px] font-mono text-white shadow-md min-w-[60px] text-center"
      style={{ backgroundColor: color, border: `1px solid ${color}` }}>
      {d.label}
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#fff", width: 6, height: 6, right: -3 }} />
    </div>
  )
})
