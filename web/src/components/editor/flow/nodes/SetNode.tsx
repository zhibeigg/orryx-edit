import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const SetNode = memo(function SetNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData

  return (
    <div className={`rounded-xl overflow-hidden min-w-[190px] border-2 border-green-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(74,222,128,0.35),0_12px_24px_rgba(0,0,0,0.32)]" : "shadow-[0_8px_16px_rgba(0,0,0,0.24)]"}`}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className="px-3 py-1 bg-green-600 text-[12px] font-medium text-white">set</div>
      <div className="bg-[#111318] px-2.5 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-white/70">变量名</span>
          <input
            type="text"
            value={String(nodeData.inputs.variable ?? "")}
            disabled={Boolean(nodeData.readOnly)}
            onChange={(event) => nodeData.onInputChange?.("variable", event.target.value, "identifier")}
            onPointerDown={stopNodeInteraction}
            onWheel={stopNodeInteraction}
            className={`${NODE_CONTROL_CLASS} flex-1 px-1.5 py-1 bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-55`}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Handle
            type="target"
            position={Position.Left}
            id="value"
            isConnectable={!nodeData.readOnly}
            style={{ background: "#6b7280", width: 8, height: 8, left: -4 }}
          />
          <span className="text-white/70">值</span>
          <input
            type="text"
            value={String(nodeData.inputs.value ?? "")}
            disabled={Boolean(nodeData.readOnly)}
            onChange={(event) => nodeData.onInputChange?.("value", event.target.value)}
            onPointerDown={stopNodeInteraction}
            onWheel={stopNodeInteraction}
            className={`${NODE_CONTROL_CLASS} flex-1 px-1.5 py-1 bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-55`}
          />
        </div>
      </div>
    </div>
  )
})
