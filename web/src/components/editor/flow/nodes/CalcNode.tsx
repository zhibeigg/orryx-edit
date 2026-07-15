import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { useSchema } from "../SchemaContext"
import { getPortColor } from "./node-styles"
import { NODE_CONTROL_CLASS, NODE_PORT_SIZE_PX, stopNodeInteraction, useNodeInternalsSync } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const CalcNode = memo(function CalcNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const outputType = String(nodeData.provides?.output ?? "number")
  useNodeInternalsSync(id, `formula:${outputType}`)

  return (
    <div className="relative overflow-visible" style={{ width: nodeData.layout?.width ?? 360 }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className={`rounded-md border bg-[#111318] transition-shadow duration-150 ${selected ? "border-fuchsia-300 shadow-[0_0_0_2px_rgba(232,121,249,0.22),0_12px_24px_rgba(0,0,0,0.3)]" : "border-fuchsia-800/80 shadow-[0_8px_18px_rgba(0,0,0,0.22)]"}`}>
        <div className="flex min-h-10 items-center justify-between gap-4 rounded-t-[5px] bg-fuchsia-950 px-4 py-2 text-[14px] font-semibold text-fuchsia-50">
          <span>表达式运算</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fuchsia-200/60">calc</span>
        </div>

        <label className="relative grid min-h-14 grid-cols-[88px_minmax(0,1fr)] items-center gap-4 px-4 py-3 text-[13px]">
          <Handle
            type="target"
            position={Position.Left}
            id="formula"
            isConnectable={!nodeData.readOnly}
            title="表达式输入"
            style={{
              background: schema ? getPortColor("string", schema) : "#c084fc",
              border: "2px solid #111318",
              width: NODE_PORT_SIZE_PX,
              height: NODE_PORT_SIZE_PX,
              left: -4,
              top: "50%",
              zIndex: 8,
            }}
          />
          <span className="text-white/68">表达式</span>
          <input
            type="text"
            value={String(nodeData.inputs.formula ?? "")}
            disabled={Boolean(nodeData.readOnly)}
            onChange={(event) => nodeData.onInputChange?.("formula", event.target.value, "string")}
            onPointerDown={stopNodeInteraction}
            onWheel={stopNodeInteraction}
            className={`${NODE_CONTROL_CLASS} min-h-9 w-full min-w-0 rounded border border-white/10 bg-black/35 px-3 py-2 font-mono text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-fuchsia-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            placeholder="例如 2+3*level"
          />
        </label>

        <div className="relative flex min-h-10 items-center justify-between gap-4 rounded-b-[5px] border-t border-white/10 bg-white/[0.035] px-4 py-2 text-[12px]">
          <span className="text-white/55">结果</span>
          <code className="min-w-0 truncate text-fuchsia-100/85">{outputType}</code>
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            isConnectable={!nodeData.readOnly}
            title={`运算输出：${outputType}`}
            style={{
              background: schema ? getPortColor(outputType, schema) : "#c084fc",
              border: "2px solid #111318",
              width: NODE_PORT_SIZE_PX,
              height: NODE_PORT_SIZE_PX,
              right: -8,
              top: "50%",
              zIndex: 8,
            }}
          />
        </div>
      </div>
    </div>
  )
})
