import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { useSchema } from "../SchemaContext"
import { getPortColor } from "./node-styles"
import { ExecutionHandles } from "./ExecutionHandles"
import { NODE_CONTROL_CLASS, stopNodeInteraction, useNodeInternalsSync } from "./node-interaction"

export const SetNode = memo(function SetNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const valueType = String(nodeData.provides?.value ?? "any")
  useNodeInternalsSync(id, `name|value:${valueType}`)

  const handleNameChange = useCallback((value: string) => {
    nodeData.onInputChange?.("variable", value)
  }, [nodeData])

  const handleValueChange = useCallback((value: string) => {
    nodeData.onInputChange?.("value", value)
  }, [nodeData])

  return (
    <div className="relative overflow-visible" style={{ width: nodeData.layout?.width ?? 300 }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className={`rounded-md border bg-[#111318] transition-shadow duration-150 ${selected ? "border-amber-300 shadow-[0_0_0_2px_rgba(251,191,36,0.22),0_12px_24px_rgba(0,0,0,0.3)]" : "border-amber-800/80 shadow-[0_8px_18px_rgba(0,0,0,0.22)]"}`}>
        <div className="flex min-h-8 items-center justify-between gap-3 rounded-t-[5px] bg-amber-950 px-3 py-1.5 text-[12px] font-semibold text-amber-50">
          <span>设置变量</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-amber-200/60">set</span>
        </div>

        <div className="grid gap-2 px-3 py-2.5">
          <label className="grid min-h-8 grid-cols-[76px_minmax(0,1fr)] items-center gap-3 text-[11px]">
            <span className="text-white/68">变量名</span>
            <input
              type="text"
              value={String(nodeData.inputs.variable ?? nodeData.inputs.name ?? "")}
              disabled={Boolean(nodeData.readOnly)}
              onChange={(event) => handleNameChange(event.target.value)}
              onPointerDown={stopNodeInteraction}
              onWheel={stopNodeInteraction}
              className={`${NODE_CONTROL_CLASS} w-full min-w-0 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            />
          </label>

          <label className="relative grid min-h-9 grid-cols-[76px_minmax(0,1fr)] items-center gap-3 text-[11px]">
            <Handle
              type="target"
              position={Position.Left}
              id="value"
              isConnectable={!nodeData.readOnly}
              title="变量值输入"
              style={{
                background: schema ? getPortColor(valueType, schema) : "#f59e0b",
                border: "2px solid #111318",
                width: 10,
                height: 10,
                left: -14,
                top: "50%",
                zIndex: 8,
              }}
            />
            <span className="text-white/68">变量值</span>
            <input
              type="text"
              value={String(nodeData.inputs.value ?? "")}
              disabled={Boolean(nodeData.readOnly)}
              onChange={(event) => handleValueChange(event.target.value)}
              onPointerDown={stopNodeInteraction}
              onWheel={stopNodeInteraction}
              className={`${NODE_CONTROL_CLASS} w-full min-w-0 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-55`}
            />
          </label>
        </div>
      </div>
    </div>
  )
})
