import { useState, useMemo, useCallback } from "react"
import type { ActionsSchemaV2, SchemaSelector } from "@/types/schema"
import { X, Plus } from "lucide-react"

interface SelectorEntry {
  selector: SchemaSelector
  negated: boolean
  params: Record<string, unknown>
}

interface SelectorBuilderProps {
  schema: ActionsSchemaV2
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function SelectorBuilder({ schema, value, onChange, onClose }: SelectorBuilderProps) {
  const [entries, setEntries] = useState<SelectorEntry[]>(() => parseSelector(value, schema))

  const preview = useMemo(() => {
    return entries.map(e => {
      const prefix = e.negated ? "!@" : "@"
      const args = e.selector.params.map(p => String(e.params[p.key] ?? p.default ?? "")).join(" ")
      return args ? `${prefix}${e.selector.name} ${args}` : `${prefix}${e.selector.name}`
    }).join(" ")
  }, [entries])

  const addSelector = useCallback((sel: SchemaSelector) => {
    const params: Record<string, unknown> = {}
    for (const p of sel.params) { if (p.default != null) params[p.key] = p.default }
    setEntries(prev => [...prev, { selector: sel, negated: false, params }])
  }, [])

  const removeEntry = useCallback((idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const toggleNegate = useCallback((idx: number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, negated: !e.negated } : e))
  }, [])

  const updateParam = useCallback((idx: number, key: string, val: unknown) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, params: { ...e.params, [key]: val } } : e))
  }, [])

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[300px] text-[#cccccc]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <span className="text-[12px] font-medium text-white">选择器构建器</span>
        <button onClick={onClose} className="p-0.5 hover:bg-[#3c3c3c] rounded"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="px-3 py-1.5 flex flex-wrap gap-1 border-b border-[#3c3c3c]">
        {schema.selectors.map(sel => (
          <button key={sel.name} onClick={() => addSelector(sel)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-[#3c3c3c] hover:bg-[#4c4c4c] rounded text-[#cccccc]">
            <Plus className="w-2.5 h-2.5" />@{sel.name}
          </button>
        ))}
      </div>

      <div className="px-3 py-2 space-y-2 max-h-[200px] overflow-y-auto">
        {entries.map((entry, idx) => (
          <div key={idx} className="flex items-start gap-1.5 bg-[#1e1e1e] rounded px-2 py-1.5">
            <button onClick={() => toggleNegate(idx)}
              className={`text-[10px] px-1 rounded shrink-0 mt-0.5 ${entry.negated ? "bg-red-600 text-white" : "bg-[#3c3c3c] text-[#cccccc]"}`}>
              {entry.negated ? "!" : ""}@{entry.selector.name}
            </button>
            <div className="flex-1 space-y-1">
              {entry.selector.params.map(p => (
                <div key={p.key} className="flex items-center gap-1 text-[10px]">
                  <span className="text-[#858585]">{p.name}:</span>
                  <input type={p.type === "DOUBLE" || p.type === "INT" ? "number" : "text"}
                    value={String(entry.params[p.key] ?? "")}
                    onChange={e => updateParam(idx, p.key, p.type === "DOUBLE" ? +e.target.value : e.target.value)}
                    className="w-14 px-1 py-0 bg-black/30 border border-white/10 rounded text-white" />
                </div>
              ))}
            </div>
            <button onClick={() => removeEntry(idx)} className="p-0.5 hover:bg-[#3c3c3c] rounded shrink-0">
              <X className="w-3 h-3 text-red-400" />
            </button>
          </div>
        ))}
        {entries.length === 0 && <div className="text-[10px] text-[#858585] text-center py-2">点击上方按钮添加选择器</div>}
      </div>

      <div className="border-t border-[#3c3c3c] px-3 py-2">
        <div className="text-[10px] text-[#858585] mb-1">预览:</div>
        <div className="text-[11px] font-mono bg-[#1e1e1e] px-2 py-1 rounded mb-2">"{preview}"</div>
        <button onClick={() => { onChange(preview); onClose() }}
          className="px-3 py-1 text-[11px] bg-[#007acc] text-white rounded hover:bg-[#006bb3]">确定</button>
      </div>
    </div>
  )
}

function parseSelector(value: string, schema: ActionsSchemaV2): SelectorEntry[] {
  if (!value) return []
  const entries: SelectorEntry[] = []
  const parts = value.replace(/^"|"$/g, "").split(/\s+/)
  let i = 0
  while (i < parts.length) {
    let part = parts[i]
    let negated = false
    if (part.startsWith("!@")) { negated = true; part = part.slice(2) }
    else if (part.startsWith("@")) { part = part.slice(1) }
    else { i++; continue }

    const sel = schema.selectors.find(s => s.name === part || (s.aliases ?? []).includes(part))
    if (sel) {
      const params: Record<string, unknown> = {}
      for (const p of sel.params) {
        i++
        if (i < parts.length && !parts[i].startsWith("@") && !parts[i].startsWith("!@")) {
          params[p.key] = p.type === "DOUBLE" ? parseFloat(parts[i]) : parts[i]
        } else { i--; break }
      }
      entries.push({ selector: sel, negated, params })
    }
    i++
  }
  return entries
}
