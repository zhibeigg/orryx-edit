import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface BloomEditorProps {
  content: string
  onChange: (yaml: string) => void
}

interface BloomConfig {
  name: string
  color: number[]
  strength: number
  radius: number
  priority: number
}

export function BloomEditor({ content, onChange }: BloomEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const rawRef = useRef(content)
  useEffect(() => {
    rawRef.current = content
  }, [content])

  const data = useMemo(() => {
    try {
      const parsed = parseYaml<Record<string, unknown>>(content)
      const syncDelay = (parsed["sync-delay"] as number) ?? 20
      const configs = (parsed.configs as Record<string, BloomConfig>) ?? {}
      return { syncDelay, configs }
    } catch {
      return { syncDelay: 20, configs: {} }
    }
  }, [content])

  const save = useCallback((newData: Record<string, unknown>) => {
    try { onChange(updateYamlFromObject(rawRef.current, newData)) }
    catch { onChange(stringifyYaml(newData)) }
  }, [onChange])

  const updateConfig = (id: string, patch: Partial<BloomConfig>) => {
    const newConfigs = { ...data.configs, [id]: { ...data.configs[id], ...patch } }
    save({ "sync-delay": data.syncDelay, configs: newConfigs })
  }

  const addConfig = () => {
    const id = `bloom_${Date.now() % 10000}`
    const newConfigs = { ...data.configs, [id]: { name: "名称", color: [255, 255, 255, 200], strength: 5, radius: 32, priority: 1 } }
    save({ "sync-delay": data.syncDelay, configs: newConfigs })
    setEditingId(id)
  }

  const removeConfig = (id: string) => {
    const { [id]: _, ...rest } = data.configs
    save({ "sync-delay": data.syncDelay, configs: rest })
  }

  const renameConfig = (oldId: string, newId: string) => {
    if (!newId.trim() || (newId !== oldId && newId in data.configs)) return
    const entries = Object.entries(data.configs).map(([k, v]) => [k === oldId ? newId : k, v])
    save({ "sync-delay": data.syncDelay, configs: Object.fromEntries(entries) })
    setEditingId(null)
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4 max-w-3xl">
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground">登录同步延迟 (tick)</label>
              <input type="number" className="w-20 px-2 py-1 text-sm bg-secondary border border-border rounded"
                value={data.syncDelay} onChange={(e) => save({ "sync-delay": parseInt(e.target.value) || 20, configs: data.configs })} />
              <div className="flex-1" />
              <button onClick={addConfig} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加泛光</button>
            </div>

            {Object.entries(data.configs).map(([id, cfg]) => (
              <div key={id} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                  {editingId === id ? (
                    <input autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      defaultValue={id}
                      onBlur={(e) => renameConfig(id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameConfig(id, e.currentTarget.value); if (e.key === "Escape") setEditingId(null) }} />
                  ) : (
                    <span className="flex-1 text-sm font-mono cursor-pointer hover:text-primary" onClick={() => setEditingId(id)}>{id}</span>
                  )}
                  <div className="w-6 h-6 rounded border border-border" style={{ backgroundColor: `rgba(${cfg.color?.join(",") ?? "255,255,255,200"})` }} />
                  <button onClick={() => removeConfig(id)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                </div>
                <div className="p-3 grid grid-cols-2 gap-3">
                  <Field label="匹配名称">
                    <input className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded" value={cfg.name ?? ""}
                      onChange={(e) => updateConfig(id, { name: e.target.value })} />
                  </Field>
                  <Field label="颜色 RGBA">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <input key={i} type="number" min={0} max={255} className="w-14 px-1 py-1 text-sm bg-secondary border border-border rounded text-center"
                          value={cfg.color?.[i] ?? 255}
                          onChange={(e) => { const c = [...(cfg.color ?? [255, 255, 255, 200])]; c[i] = parseInt(e.target.value) || 0; updateConfig(id, { color: c }) }} />
                      ))}
                    </div>
                  </Field>
                  <Field label="强度 (0-10)">
                    <input type="number" min={0} max={10} className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.strength ?? 5} onChange={(e) => updateConfig(id, { strength: parseFloat(e.target.value) || 0 })} />
                  </Field>
                  <Field label="渲染距离 (方块)">
                    <input type="number" min={1} max={128} className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.radius ?? 32} onChange={(e) => updateConfig(id, { radius: parseInt(e.target.value) || 32 })} />
                  </Field>
                  <Field label="优先级">
                    <input type="number" className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.priority ?? 1} onChange={(e) => updateConfig(id, { priority: parseInt(e.target.value) || 1 })} />
                  </Field>
                </div>
              </div>
            ))}
            {Object.keys(data.configs).length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无泛光配置</div>}
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

// ---- 共享组件 ----

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}
