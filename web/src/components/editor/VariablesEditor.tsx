import { useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { commitVariableValueDraft, renameRecordKey } from "./editor-input-utils"
import { useEditorInputFlush } from "@/lib/editor-input-flush"

interface VariablesEditorProps {
  variables: Record<string, string | number>
  onChange: (variables: Record<string, string | number>) => void
}

interface VariableRowMeta {
  id: string
  sourceKey: string
}

let nextVariableRowId = 0
function createRow(sourceKey: string): VariableRowMeta {
  nextVariableRowId += 1
  return { id: `variable-row-${nextVariableRowId}`, sourceKey }
}

export function VariablesEditor({ variables, onChange }: VariablesEditorProps) {
  const variableKeys = Object.keys(variables)
  const keySignature = variableKeys.join("\u0000")
  const [rows, setRows] = useState<VariableRowMeta[]>(() => variableKeys.map(createRow))
  const [previousKeySignature, setPreviousKeySignature] = useState(keySignature)

  if (keySignature !== previousKeySignature) {
    const retained = rows.filter((row) => row.sourceKey in variables)
    const known = new Set(retained.map((row) => row.sourceKey))
    const added = variableKeys.filter((key) => !known.has(key)).map(createRow)
    setRows([...retained, ...added])
    setPreviousKeySignature(keySignature)
  }

  const commitKey = (oldKey: string, draft: string): boolean => {
    const renamed = renameRecordKey(variables, oldKey, draft)
    if (!renamed) return false
    const newKey = draft.trim()
    if (newKey !== oldKey) {
      setRows((current) => current.map((row) => row.sourceKey === oldKey ? { ...row, sourceKey: newKey } : row))
      onChange(renamed)
    }
    return true
  }

  const commitValue = (key: string, draft: string) => {
    const value = commitVariableValueDraft(draft)
    if (variables[key] !== value) onChange({ ...variables, [key]: value })
  }

  const addEntry = () => {
    let index = Object.keys(variables).length
    let key = `NewVar${index}`
    while (key in variables) {
      index += 1
      key = `NewVar${index}`
    }
    setRows((current) => [...current, createRow(key)])
    onChange({ ...variables, [key]: 0 })
  }

  const removeEntry = (key: string) => {
    const newVars = { ...variables }
    delete newVars[key]
    setRows((current) => current.filter((row) => row.sourceKey !== key))
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
        {rows.map((row) => {
          const value = variables[row.sourceKey]
          if (value === undefined) return null
          return (
            <VariableRow
              key={row.id}
              sourceKey={row.sourceKey}
              value={value}
              onCommitKey={commitKey}
              onCommitValue={commitValue}
              onRemove={removeEntry}
            />
          )
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">暂无变量</p>}
      </div>
    </div>
  )
}

function VariableRow({ sourceKey, value, onCommitKey, onCommitValue, onRemove }: {
  sourceKey: string
  value: string | number
  onCommitKey: (oldKey: string, draft: string) => boolean
  onCommitValue: (key: string, draft: string) => void
  onRemove: (key: string) => void
}) {
  const externalValue = String(value)
  const keyInputRef = useRef<HTMLInputElement | null>(null)
  const valueInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [keyDraft, setKeyDraft] = useState(sourceKey)
  const [previousSourceKey, setPreviousSourceKey] = useState(sourceKey)
  const [valueDraft, setValueDraft] = useState(externalValue)
  const [previousExternalValue, setPreviousExternalValue] = useState(externalValue)

  if (sourceKey !== previousSourceKey) {
    setPreviousSourceKey(sourceKey)
    setKeyDraft(sourceKey)
  }
  if (externalValue !== previousExternalValue) {
    setPreviousExternalValue(externalValue)
    setValueDraft(externalValue)
  }

  const submitKey = (): boolean => {
    const accepted = onCommitKey(sourceKey, keyDraft)
    if (!accepted) setKeyDraft(sourceKey)
    return accepted
  }

  const submitValue = () => {
    onCommitValue(sourceKey, valueDraft)
    return true
  }

  useEditorInputFlush(() => {
    const keyChanged = keyDraft.trim() !== sourceKey
    const valueChanged = valueDraft !== externalValue
    if (keyChanged && valueChanged) {
      keyInputRef.current?.focus()
      return false
    }
    if (keyChanged) return submitKey()
    if (valueChanged) return submitValue()
    return true
  })

  return (
    <div className="flex items-center gap-2">
      <input
        ref={keyInputRef}
        value={keyDraft}
        onChange={(event) => setKeyDraft(event.target.value)}
        onBlur={submitKey}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submitKey()
            event.currentTarget.blur()
          }
          if (event.key === "Escape") setKeyDraft(sourceKey)
        }}
        className="w-32 px-2 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="变量名"
      />
      <span className="text-muted-foreground">=</span>
      <textarea
        ref={valueInputRef}
        value={valueDraft}
        onChange={(event) => setValueDraft(event.target.value)}
        onBlur={submitValue}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur()
        }}
        rows={valueDraft.includes("\n") ? 3 : 1}
        className="flex-1 px-2 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
        placeholder="值或 calc 表达式"
      />
      <button onClick={() => onRemove(sourceKey)} className="text-muted-foreground hover:text-red-400 p-1">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
