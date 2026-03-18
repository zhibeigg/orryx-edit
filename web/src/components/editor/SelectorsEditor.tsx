import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { ActionsEditor } from "./ActionsEditor"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface SelectorsEditorProps {
  content: string
  onChange: (yaml: string) => void
}

interface SelectorEntry {
  key: string
  actions: string
}

type Tab = "visual" | "yaml"

export function SelectorsEditor({ content, onChange }: SelectorsEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("visual")
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawRef = useRef(content)
  rawRef.current = content

  const entries = useMemo<SelectorEntry[]>(() => {
    try {
      const data = parseYaml<Record<string, { Actions?: string }>>(content)
      return Object.entries(data).map(([key, val]) => ({
        key,
        actions: typeof val === "object" && val !== null ? (val.Actions ?? "") : String(val),
      }))
    } catch { return [] }
  }, [content])

  const save = useCallback((newEntries: SelectorEntry[]) => {
    const obj: Record<string, { Actions: string }> = {}
    for (const e of newEntries) obj[e.key] = { Actions: e.actions }
    try { onChange(updateYamlFromObject(rawRef.current, obj as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml(obj)) }
  }, [onChange])

  const addSelector = () => {
    const key = `新选择器_${Date.now() % 1000}`
    save([...entries, { key, actions: "container" }])
    setEditingKey(key)
  }

  const removeSelector = (key: string) => save(entries.filter((e) => e.key !== key))

  const renameSelector = (oldKey: string, newKey: string) => {
    if (!newKey.trim() || (newKey !== oldKey && entries.some((e) => e.key === newKey))) return
    save(entries.map((e) => (e.key === oldKey ? { ...e, key: newKey } : e)))
    setEditingKey(null)
  }

  const updateActions = (key: string, actions: string) => {
    save(entries.map((e) => (e.key === key ? { ...e, actions } : e)))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        {(["visual", "yaml"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
            activeTab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t === "visual" ? "可视化" : "YAML 源码"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "visual" && (
          <div className="p-4 space-y-3 max-w-4xl">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                自定义选择器，在 Kether 脚本中通过 <code className="text-zinc-300">@选择器名</code> 使用
              </div>
              <button onClick={addSelector} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加选择器</button>
            </div>

            {entries.map((entry) => (
              <div key={entry.key} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">@</span>
                  {editingKey === entry.key ? (
                    <input autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      defaultValue={entry.key}
                      onBlur={(e) => renameSelector(entry.key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameSelector(entry.key, e.currentTarget.value); if (e.key === "Escape") setEditingKey(null) }} />
                  ) : (
                    <span className="flex-1 text-sm font-mono font-semibold cursor-pointer hover:text-primary"
                      onClick={() => setEditingKey(entry.key)}>{entry.key}</span>
                  )}
                  <button onClick={() => removeSelector(entry.key)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                </div>
                <ActionsEditor value={entry.actions} onChange={(v) => updateActions(entry.key, v)} height="120px" />
              </div>
            ))}
            {entries.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无自定义选择器</div>}
          </div>
        )}
        {activeTab === "yaml" && (
          <div className="h-full">
            <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
              options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
          </div>
        )}
      </div>
    </div>
  )
}
