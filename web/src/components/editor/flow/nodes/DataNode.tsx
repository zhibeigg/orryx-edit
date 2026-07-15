import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { useSchema } from "../SchemaContext"
import { getPortColor } from "./node-styles"
import { NODE_CONTROL_CLASS, NODE_PORT_SIZE_PX, stopNodeInteraction, useNodeInternalsSync } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

export const DataNode = memo(function DataNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const valueKey = Object.prototype.hasOwnProperty.call(nodeData.inputs, "literal") ? "literal" : "value"
  const builtin = String(nodeData.inputs.builtin ?? nodeData.inputKinds[valueKey] ?? "literal")
  const outputType = String(nodeData.provides?.output ?? nodeData.inputKinds[valueKey] ?? "any")
  const canEdit = !nodeData.readOnly && (builtin === "literal" || valueKey === "value")
  useNodeInternalsSync(id, `${builtin}:${outputType}:${valueKey}`)

  const handleLiteralChange = useCallback((value: string) => {
    nodeData.onInputChange?.(valueKey, value)
  }, [nodeData, valueKey])

  return (
    <div className="relative overflow-visible" style={{ width: nodeData.layout?.width ?? 320 }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className={`rounded-md border bg-[#111318] transition-shadow duration-150 ${selected ? "border-cyan-300 shadow-[0_0_0_2px_rgba(34,211,238,0.22),0_12px_24px_rgba(0,0,0,0.3)]" : "border-cyan-800/80 shadow-[0_8px_18px_rgba(0,0,0,0.22)]"}`}>
        <div className="flex min-h-10 items-center justify-between gap-4 rounded-t-[5px] bg-cyan-950 px-4 py-2 text-[14px] font-semibold text-cyan-50">
          <span className="min-w-0 truncate">{nodeData.label}</span>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-cyan-200/65">{builtin}</span>
        </div>

        <div className="px-4 py-3">
          <input
            type="text"
            value={String(nodeData.inputs[valueKey] ?? "")}
            disabled={!canEdit}
            onChange={(event) => handleLiteralChange(event.target.value)}
            onPointerDown={stopNodeInteraction}
            onWheel={stopNodeInteraction}
            className={`${NODE_CONTROL_CLASS} min-h-9 w-full min-w-0 rounded border border-white/10 bg-black/35 px-3 py-2 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
          />
        </div>

        <div className="relative flex min-h-10 items-center justify-between gap-4 rounded-b-[5px] border-t border-white/10 bg-white/[0.035] px-4 py-2 text-[12px]">
          <span className="text-white/55">数据输出</span>
          <code className="min-w-0 truncate text-cyan-100/85">{outputType}</code>
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            isConnectable={!nodeData.readOnly}
            title={`数据输出：${outputType}`}
            style={{
              background: schema ? getPortColor(outputType, schema) : "#22d3ee",
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
