import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const CalcNode = memo(function CalcNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData

  return (
    <div className={`rounded-xl overflow-hidden min-w-[190px] border-2 border-cyan-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(34,211,238,0.35),0_12px_24px_rgba(0,0,0,0.32)]" : "shadow-[0_8px_16px_rgba(0,0,0,0.24)]"}`}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className="px-3 py-1 bg-cyan-600 text-[12px] font-medium text-white">calc</div>
      <div className="bg-[#111318] px-2 py-2">
        <input
          type="text"
          value={String(nodeData.inputs.formula ?? "")}
          disabled={Boolean(nodeData.readOnly)}
          onChange={(event) => nodeData.onInputChange?.("formula", event.target.value, "string")}
          onPointerDown={stopNodeInteraction}
          onWheel={stopNodeInteraction}
          className={`${NODE_CONTROL_CLASS} w-full px-1.5 py-1 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-55`}
          placeholder="表达式..."
        />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        isConnectable={!nodeData.readOnly}
        style={{ background: "#06b6d4", width: 8, height: 8, right: -4 }}
      />
    </div>
  )
})
