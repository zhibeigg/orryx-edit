import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherInputKind, KetherNodeData } from "../flow-types"
import type { SchemaType } from "@/types/schema"
import { getNodeColor, getPortColor } from "./node-styles"
import { useSchema } from "../SchemaContext"
import { NODE_CONTROL_CLASS, stopNodeInteraction, useNodeInternalsSync } from "./node-interaction"
import { ExecutionHandles } from "./ExecutionHandles"

function ParamWidget({ type, typeDef, value, options, disabled, onChange }: {
  type: string
  typeDef?: SchemaType
  value: unknown
  options?: string[]
  disabled: boolean
  onChange: (value: unknown, kind?: KetherInputKind) => void
}) {
  const normalizedType = type.toLowerCase()
  const commonClass = `${NODE_CONTROL_CLASS} w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-55`
  const interactionProps = { onPointerDown: stopNodeInteraction, onWheel: stopNodeInteraction }

  if (typeDef && !typeDef.ketherFillable && typeDef.inputStrategy === "raw") {
    return (
      <textarea
        rows={2}
        value={String(value ?? "")}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value, "raw")}
        {...interactionProps}
        className={`${commonClass} resize-y border border-[oklch(0.38_0.055_34)] bg-[oklch(0.13_0.012_35)] px-2 py-1.5 font-mono text-[10px] text-[oklch(0.91_0.025_78)]`}
        aria-label={`${type} 原始值`}
      />
    )
  }

  if (["double", "int", "long", "number"].includes(normalizedType)) {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value, "number")}
        {...interactionProps}
        className={`${commonClass} px-2 py-1.5 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70`}
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
        className={`${commonClass} min-h-7 px-2 py-1 text-[10px] rounded border ${enabled ? "border-emerald-500/60 bg-emerald-700 text-emerald-50" : "border-white/10 bg-zinc-700 text-zinc-200"}`}
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
        className={`${commonClass} px-2 py-1.5 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70`}
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
      className={`${commonClass} px-2 py-1.5 text-[11px] bg-black/35 border border-white/10 rounded text-white focus:outline-none focus:ring-1 focus:ring-amber-300/70`}
    />
  )
}

export const ActionNode = memo(function ActionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  const schema = useSchema()
  const schemaAction = nodeData.schemaAction
  const signature = `${schemaAction?.name ?? nodeData.label}:${schemaAction?.inputs.map((input) => input.key).join("|") ?? "unknown"}:${schemaAction?.output?.type ?? "none"}`
  useNodeInternalsSync(id, signature)

  const handleInputChange = useCallback((key: string, value: unknown, kind?: KetherInputKind) => {
    nodeData.onInputChange?.(key, value, kind)
  }, [nodeData])

  const color = schemaAction && schema ? getNodeColor(schemaAction, schema) : "#6b7280"
  const width = nodeData.layout?.width ?? 320

  return (
    <div className="relative overflow-visible" style={{ width }}>
      <ExecutionHandles disabled={Boolean(nodeData.readOnly)} />
      <div
        className={`kether-block ${selected ? "is-selected" : ""} ${nodeData.readOnly ? "is-readonly" : ""}`}
        style={{ borderColor: color }}
        data-shape={schemaAction?.shape ?? "command"}
      >
        <div className="kether-block__header" style={{ borderTop: `2px solid ${color}` }}>
          <span className="min-w-0 flex-1 truncate" title={nodeData.label}>{nodeData.label}</span>
          {schemaAction && <span className="kether-block__variant">{schemaAction.syntax.split(/\s+/).slice(1, 3).join(" ") || schemaAction.shape}</span>}
        </div>

        <div className="grid gap-1.5 px-3 py-2.5">
          {schemaAction ? schemaAction.inputs.map((input) => (
            <div
              key={input.key}
              className="relative grid min-h-9 grid-cols-[minmax(96px,0.9fr)_minmax(132px,1.3fr)] items-center gap-3 rounded-sm px-1 py-0.5 text-[11px]"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={input.key}
                isConnectable={!nodeData.readOnly}
                title={`输入：${input.name}`}
                style={{
                  background: schema ? getPortColor(input.type, schema) : "#6b7280",
                  border: "2px solid #111318",
                  width: 10,
                  height: 10,
                  left: -14,
                  top: "50%",
                  zIndex: 8,
                }}
              />
              <span className="min-w-0 break-words text-white/75" title={input.description ?? input.name}>{input.name}</span>
              <ParamWidget
                type={input.type}
                typeDef={schema?.types[input.type]}
                value={Object.prototype.hasOwnProperty.call(nodeData.inputs, input.key) ? nodeData.inputs[input.key] : input.default}
                options={input.options}
                disabled={Boolean(nodeData.readOnly)}
                onChange={(value, kind) => handleInputChange(input.key, value, kind)}
              />
            </div>
          )) : (
            <div className="px-1 py-2 text-[11px] text-white/45">未知 action：{nodeData.label}</div>
          )}
        </div>

        {schemaAction?.output && (
          <div className="relative flex min-h-8 items-center justify-between gap-3 rounded-b-[5px] border-t border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px]">
            <span className="text-white/55">输出</span>
            <code className="min-w-0 truncate text-white/80">{schemaAction.output.type}</code>
            <Handle
              type="source"
              position={Position.Right}
              id="output"
              isConnectable={!nodeData.readOnly}
              title={`输出：${schemaAction.output.type}`}
              style={{
                background: schema ? getPortColor(schemaAction.output.type, schema) : "#6b7280",
                border: "2px solid #111318",
                width: 10,
                height: 10,
                right: -6,
                top: "50%",
                zIndex: 8,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
})
