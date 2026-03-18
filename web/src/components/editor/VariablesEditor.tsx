import { Plus, Trash2 } from "lucide-react"

interface VariablesEditorProps {
  variables: Record<string, string | number>
  onChange: (variables: Record<string, string | number>) => void
}

export function VariablesEditor({ variables, onChange }: VariablesEditorProps) {
  const entries = Object.entries(variables)

  const updateKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return
    // 检测键名冲突
    if (newKey in variables && newKey !== oldKey) return
    const newVars: Record<string, string | number> = {}
    for (const [k, v] of entries) {
      newVars[k === oldKey ? newKey : k] = v
    }
    onChange(newVars)
  }

  const updateValue = (key: string, value: string) => {
    const numVal = Number(value)
    onChange({ ...variables, [key]: isNaN(numVal) || value.includes(" ") ? value : numVal })
  }

  const addEntry = () => {
    const key = `NewVar${entries.length}`
    onChange({ ...variables, [key]: 0 })
  }

  const removeEntry = (key: string) => {
    const newVars = { ...variables }
    delete newVars[key]
    onChange(newVars)
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">变量 (Variables)</h3>
        <button onClick={addEntry} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="w-3.5 h-3.5" /> 添加
        </button>
      </div>

      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              className="w-32 px-2 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="变量名"
            />
            <span className="text-muted-foreground">=</span>
            <textarea
              value={String(value)}
              onChange={(e) => updateValue(key, e.target.value)}
              rows={typeof value === "string" && value.includes("\n") ? 3 : 1}
              className="flex-1 px-2 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
              placeholder="值或 calc 表达式"
            />
            <button onClick={() => removeEntry(key)} className="text-muted-foreground hover:text-red-400 p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无变量</p>
        )}
      </div>
    </div>
  )
}
