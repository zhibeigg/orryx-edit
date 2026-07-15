import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherInputKind, KetherNodeData } from "../flow-types"
import { getPortColor } from "./node-styles"
import { useSchema } from "../SchemaContext"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

function ParamWidget({ type, value, options, disabled, onChange }: {
  type: string
  value: unknown
  options?: string[]
  disabled: boolean
  onChange: (value: unknown, kind?: KetherInputKind) => void
}) {
  const normalizedType = type.toLowerCase()
  const commonClass = `${NODE_CONTROL_CLASS} disabled:cursor-not-allowed disabled:opacity-55`
  const interactionProps = { onPointerDown: stopNodeInteraction, onWheel: stopNodeInteraction }

  if (["double", "int", "long", "number"].includes(normalizedType)) {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value, "number")}
        {...interactionProps}
        className={`${commonClass} w-20 px-1.5 py-1 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-sky-400/70`}
      />
    )
  }

  if (["boolean", "bool"].includes(normalizedType)) {
    const enabled = value === true || String(value).toLowerCase() === "true"
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!enabled, "boolean")}
        {...interactionProps}
        className={`${commonClass} px-2 py-0.5 text-[10px] rounded ${enabled ? "bg-green-600" : "bg-zinc-600"}`}
      >
        {enabled ? "开" : "关"}
      </button>
    )
  }

  if (normalizedType === "enum" || (options?.length ?? 0) > 0) {
    return (
      <select
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...interactionProps}
        className={`${commonClass} px-1.5 py-1 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-sky-400/70`}
      >
        {(options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }

  return (
    <input
      type="text"
      value={String(value ?? "")}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      {...interactionProps}
      className={`${commonClass} w-24 px-1.5 py-1 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-sky-400/70`}
    />
  )
}

export const ActionNode = memo(function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const schemaAction = nodeData.schemaAction

  const handleInputChange = useCallback((key: string, value: unknown, kind?: KetherInputKind) => {
    nodeData.onInputChange?.(key, value, kind)
  }, [nodeData])

  const color = schemaAction ? "#3b82f6" : "#6b7280"

  return (
    <div
      className={`rounded-xl overflow-hidden min-w-[220px] transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(147,197,253,0.45),0_14px_28px_rgba(0,0,0,0.35)]" : "shadow-[0_10px_20px_rgba(0,0,0,0.25)]"}`}
      style={{ border: `2px solid ${color}` }}
    >
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div className="px-3 py-1.5 text-[12px] font-medium text-white flex items-center gap-1.5" style={{ backgroundColor: color }}>
        <span>{nodeData.label}</span>
        {schemaAction && <span className="text-[9px] opacity-70 ml-auto">{schemaAction.category}</span>}
      </div>

      <div className="bg-[#111318] px-2.5 py-2 space-y-2">
        {schemaAction ? schemaAction.inputs.map((input) => (
          <div key={input.key} className="flex items-center gap-1.5 text-[11px]">
            <Handle
              type="target"
              position={Position.Left}
              id={input.key}
              isConnectable={!nodeData.readOnly}
              style={{ background: schema ? getPortColor(input.type, schema) : "#6b7280", width: 8, height: 8, left: -4 }}
            />
            <span className="text-white/75 shrink-0">{input.name}</span>
            <div className="ml-auto">
              <ParamWidget
                type={input.type}
                value={Object.prototype.hasOwnProperty.call(nodeData.inputs, input.key) ? nodeData.inputs[input.key] : input.default}
                options={input.options}
                disabled={Boolean(nodeData.readOnly)}
                onChange={(value, kind) => handleInputChange(input.key, value, kind)}
              />
            </div>
          </div>
        )) : (
          <div className="text-[11px] text-white/40">未知 action: {nodeData.label}</div>
        )}
      </div>

      {schemaAction?.output && (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          isConnectable={!nodeData.readOnly}
          style={{ background: schema ? getPortColor(schemaAction.output.type, schema) : "#6b7280", width: 8, height: 8, right: -4 }}
        />
      )}
    </div>
  )
})
