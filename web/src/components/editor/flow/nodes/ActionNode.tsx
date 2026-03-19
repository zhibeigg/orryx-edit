import { memo, useCallback } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { getPortColor } from "./node-styles"
import { useSchema } from "../SchemaContext"

function ParamWidget({ type, value, options, onChange }: {
  type: string; value: unknown; options?: string[]; onChange: (v: unknown) => void
}) {
  switch (type) {
    case "DOUBLE": case "INT":
      return <input type="number" value={Number(value ?? 0)} onChange={e => onChange(+e.target.value)}
        className="w-16 px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white" />
    case "BOOLEAN":
      return <button onClick={() => onChange(!value)}
        className={`px-2 py-0.5 text-[10px] rounded ${value ? "bg-green-600" : "bg-zinc-600"}`}>
        {value ? "开" : "关"}
      </button>
    case "ENUM":
      return <select value={String(value ?? "")} onChange={e => onChange(e.target.value)}
        className="px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white">
        {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    case "STRING":
      return <input type="text" value={String(value ?? "")} onChange={e => onChange(e.target.value)}
        className="w-20 px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white" />
    default:
      return <span className="text-[10px] text-white/50">{String(value ?? "—")}</span>
  }
}

export const ActionNode = memo(function ActionNode({ id, data }: NodeProps) {
  const d = data as KetherNodeData
  const schema = useSchema()
  const schemaAction = d.schemaAction
  const { updateNodeData } = useReactFlow()

  const handleInputChange = useCallback((key: string, value: unknown) => {
    updateNodeData(id, { inputs: { ...d.inputs, [key]: value } })
  }, [id, d.inputs, updateNodeData])

  const color = schemaAction ? "#3b82f6" : "#6b7280"

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[200px]" style={{ border: `2px solid ${color}` }}>
      <div className="px-3 py-1.5 text-[12px] font-medium text-white flex items-center gap-1.5"
        style={{ backgroundColor: color }}>
        <span>{d.label}</span>
        {schemaAction && <span className="text-[9px] opacity-70 ml-auto">{schemaAction.category}</span>}
      </div>

      <div className="bg-[#1e1e1e] px-2 py-1.5 space-y-1.5">
        {(schemaAction?.inputs ?? []).map((input) => (
          <div key={input.key} className="flex items-center gap-1.5 text-[11px]">
            <Handle type="target" position={Position.Left} id={input.key}
              style={{ background: schema ? getPortColor(input.type, schema) : "#6b7280", width: 8, height: 8, left: -4 }} />
            <span className="text-white/70 shrink-0">{input.name}</span>
            <div className="ml-auto">
              <ParamWidget type={input.type} value={d.inputs[input.key] ?? input.default}
                options={input.options} onChange={v => handleInputChange(input.key, v)} />
            </div>
          </div>
        )) ?? (
          <div className="text-[11px] text-white/40">未知 action: {d.label}</div>
        )}
      </div>

      {schemaAction?.output && (
        <Handle type="source" position={Position.Right} id="output"
          style={{ background: schema ? getPortColor(schemaAction.output.type, schema) : "#6b7280", width: 8, height: 8, right: -4 }} />
      )}
    </div>
  )
})
