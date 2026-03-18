import { useState, useMemo, useCallback } from "react"
import type { SchemaAction, ActionsSchemaV2 } from "@/types/schema"
import { generateKetherText } from "@/lib/parameter-wizard"
import { X, ChevronDown } from "lucide-react"

interface ParameterWizardProps {
  action: SchemaAction
  schema: ActionsSchemaV2
  initialValues: Record<string, unknown>
  onInsert: (text: string) => void
  onCancel: () => void
}

export function ParameterWizard({ action, schema, initialValues, onInsert, onCancel }: ParameterWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [showOptional, setShowOptional] = useState(false)

  const required = useMemo(() => action.inputs.filter(p => p.required), [action])
  const optional = useMemo(() => action.inputs.filter(p => !p.required), [action])

  const preview = useMemo(() => generateKetherText(action, values), [action, values])

  const updateValue = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const renderWidget = (input: SchemaAction["inputs"][0]) => {
    const val = values[input.key] ?? input.default
    const typeInfo = schema.types[input.type]
    const widget = typeInfo?.widget ?? "text"

    switch (widget) {
      case "number":
        return (
          <input
            type="number"
            value={Number(val ?? 0)}
            onChange={e => updateValue(input.key, +e.target.value)}
            min={input.min}
            max={input.max}
            step={input.step ?? typeInfo?.step}
            className="w-20 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white"
          />
        )
      case "toggle":
        return (
          <button
            onClick={() => updateValue(input.key, !val)}
            className={`px-2 py-0.5 text-[11px] rounded ${val ? "bg-green-600 text-white" : "bg-[#3c3c3c] text-[#858585]"}`}
          >
            {val ? "开启" : "关闭"}
          </button>
        )
      case "select":
        return (
          <select
            value={String(val ?? "")}
            onChange={e => updateValue(input.key, e.target.value)}
            className="px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white"
          >
            {(input.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      case "selector":
        return (
          <input
            type="text"
            value={String(val ?? "")}
            onChange={e => updateValue(input.key, e.target.value)}
            placeholder="@range 5 !@self"
            className="w-32 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white font-mono"
          />
        )
      default:
        return (
          <input
            type="text"
            value={String(val ?? "")}
            onChange={e => updateValue(input.key, e.target.value)}
            className="w-24 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white"
          />
        )
    }
  }

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[360px] text-[#cccccc]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-white">{action.name}</span>
          <span className="text-[10px] text-[#858585]">{action.category}</span>
        </div>
        <button onClick={onCancel} className="p-0.5 hover:bg-[#3c3c3c] rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2">
        {required.map(input => (
          <div key={input.key} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#cccccc] shrink-0">{input.name}</span>
            {renderWidget(input)}
            <span className="text-[9px] text-[#858585] shrink-0">{input.type}</span>
          </div>
        ))}
      </div>

      {optional.length > 0 && (
        <div className="border-t border-[#3c3c3c]">
          <button
            onClick={() => setShowOptional(!showOptional)}
            className="w-full px-3 py-1 text-[10px] text-[#858585] hover:bg-[#2a2d2e] flex items-center gap-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showOptional ? "" : "-rotate-90"}`} />
            可选参数 ({optional.length})
          </button>
          {showOptional && (
            <div className="px-3 py-2 space-y-2">
              {optional.map(input => (
                <div key={input.key} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#cccccc] shrink-0">{input.name}</span>
                  {renderWidget(input)}
                  <span className="text-[9px] text-[#858585] shrink-0">{input.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-[#3c3c3c] px-3 py-2">
        <div className="text-[10px] text-[#858585] mb-1">预览:</div>
        <div className="text-[11px] font-mono bg-[#1e1e1e] px-2 py-1 rounded mb-2 break-all">{preview}</div>
        <div className="flex gap-2">
          <button
            onClick={() => onInsert(preview)}
            className="px-3 py-1 text-[11px] bg-[#007acc] text-white rounded hover:bg-[#006bb3]"
          >
            插入
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 text-[11px] bg-[#3c3c3c] text-[#cccccc] rounded hover:bg-[#4c4c4c]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
