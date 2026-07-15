import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { BUILTIN_COLORS } from "./node-styles"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const DataNode = memo(function DataNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const color = BUILTIN_COLORS[nodeData.astRef?.type ?? "data"] ?? "#6366f1"
  const numeric = nodeData.inputKinds.value === "number"

  return (
    <div
      className={`rounded-md px-2 py-1.5 text-[12px] font-mono text-white min-w-[92px] text-center transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(199,210,254,0.5),0_10px_24px_rgba(0,0,0,0.3)]" : "shadow-[0_6px_14px_rgba(0,0,0,0.22)]"}`}
      style={{ backgroundColor: color, border: `1px solid ${color}` }}
    >
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <input
        type="text"
        inputMode={numeric ? "decimal" : "text"}
        value={String(nodeData.inputs.value ?? "")}
        disabled={Boolean(nodeData.readOnly)}
        onChange={(event) => nodeData.onInputChange?.("value", event.target.value)}
        onPointerDown={stopNodeInteraction}
        onWheel={stopNodeInteraction}
        className={`${NODE_CONTROL_CLASS} w-full min-w-[72px] bg-black/25 border border-white/15 rounded px-1 py-0.5 text-center text-white focus:outline-none focus:ring-1 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-60`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        isConnectable={!nodeData.readOnly}
        style={{ background: "#fff", width: 6, height: 6, right: -3 }}
      />
    </div>
  )
})
