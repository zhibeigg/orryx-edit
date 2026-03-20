import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface KeysEditorProps {
  content: string
  onChange: (yaml: string) => void
}

interface KeyConfig {
  sort: number
  category?: string
  default?: string
}

export function KeysEditor({ content, onChange }: KeysEditorProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawRef = useRef(content)
  useEffect(() => {
    rawRef.current = content
  }, [content])

  const data = useMemo(() => {
    try {
      const parsed = parseYaml<{ Keys?: Record<string, KeyConfig> }>(content)
      return parsed.Keys ?? {}
    } catch { return {} }
  }, [content])

  const save = useCallback((keys: Record<string, KeyConfig>) => {
    try { onChange(updateYamlFromObject(rawRef.current, { Keys: keys } as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml({ Keys: keys })) }
  }, [onChange])

  const addKey = () => {
    const id = `新按键_${Date.now() % 1000}`
    save({ ...data, [id]: { sort: Object.keys(data).length + 1 } })
    setEditingKey(id)
  }

  const removeKey = (id: string) => {
    const { [id]: _removed, ...rest } = data
    void _removed
    save(rest)
  }

  const renameKey = (oldId: string, newId: string) => {
    if (!newId.trim() || (newId !== oldId && newId in data)) return
    const entries = Object.entries(data).map(([k, v]) => [k === oldId ? newId : k, v])
    save(Object.fromEntries(entries))
    setEditingKey(null)
  }

  const updateKey = (id: string, patch: Partial<KeyConfig>) => {
    save({ ...data, [id]: { ...data[id], ...patch } })
  }

  const sorted = Object.entries(data).sort(([, a], [, b]) => (a.sort ?? 0) - (b.sort ?? 0))

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3 max-w-2xl">
            <div className="flex justify-end">
              <button onClick={addKey} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加按键</button>
            </div>

            {sorted.map(([id, cfg]) => (
              <div key={id} className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded border border-border group">
                <span className="text-xs text-muted-foreground w-6 text-center">{cfg.sort}</span>
                {editingKey === id ? (
                  <input autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                    defaultValue={id}
                    onBlur={(e) => renameKey(id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") renameKey(id, e.currentTarget.value); if (e.key === "Escape") setEditingKey(null) }} />
                ) : (
                  <span className="flex-1 text-sm font-mono font-semibold cursor-pointer hover:text-primary" onClick={() => setEditingKey(id)}>{id}</span>
                )}
                <input type="number" className="w-16 px-2 py-0.5 text-xs bg-secondary border border-border rounded text-center"
                  value={cfg.sort ?? 0} onChange={(e) => updateKey(id, { sort: parseInt(e.target.value) || 0 })} title="排序" />
                {cfg.category !== undefined && (
                  <input className="w-24 px-2 py-0.5 text-xs bg-secondary border border-border rounded"
                    value={cfg.category ?? ""} onChange={(e) => updateKey(id, { category: e.target.value })} placeholder="分类" />
                )}
                {cfg.default !== undefined && (
                  <input className="w-20 px-2 py-0.5 text-xs bg-secondary border border-border rounded"
                    value={cfg.default ?? ""} onChange={(e) => updateKey(id, { default: e.target.value })} placeholder="默认键" />
                )}
                <button onClick={() => removeKey(id)} className="text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100">删除</button>
              </div>
            ))}
            {sorted.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无按键配置</div>}
          </div>
      </TabsContent>

      <TabsContent value="yaml" className="flex-1 overflow-y-auto">
          <div className="h-full">
            <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
              options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
          </div>
      </TabsContent>
    </Tabs>
  )
}
