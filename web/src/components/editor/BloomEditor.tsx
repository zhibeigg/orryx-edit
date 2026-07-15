import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { safeParseYaml, updateYamlPaths, type YamlPathMutation } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
import { BufferedNumberInput } from "./BufferedNumberInput"
import { BufferedTextInput } from "./BufferedTextInput"
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

  const parsed = useMemo(() => safeParseYaml<Record<string, unknown>>(content), [content])
  const root = parsed.ok ? parsed.data : {}
  const data = {
    syncDelay: (root["sync-delay"] as number) ?? 20,
    configs: (root.configs as Record<string, BloomConfig>) ?? {},
  }

  const mutate = useCallback((mutations: YamlPathMutation[]) => {
    onChange(updateYamlPaths(rawRef.current, mutations))
  }, [onChange])

  const updateConfig = (id: string, patch: Partial<BloomConfig>) => {
    mutate(Object.entries(patch).map(([key, value]) => ({
      type: "set" as const,
      path: ["configs", id, key],
      value,
    })))
  }

  const addConfig = () => {
    const id = `bloom_${Date.now() % 10000}`
    mutate([{ type: "set", path: ["configs", id], value: { name: "名称", color: [255, 255, 255, 200], strength: 5, radius: 32, priority: 1 } }])
    setEditingId(id)
  }

  const removeConfig = (id: string) => mutate([{ type: "delete", path: ["configs", id] }])

  const renameConfig = (oldId: string, newId: string): boolean => {
    const trimmed = newId.trim()
    if (!trimmed || (trimmed !== oldId && trimmed in data.configs)) return false
    mutate([{ type: "rename", path: ["configs", oldId], newKey: trimmed }])
    setEditingId(null)
    return true
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <div className="p-4 space-y-4 max-w-3xl">
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground">登录同步延迟 (tick)</label>
              <BufferedNumberInput mode="integer" className="w-20 px-2 py-1 text-sm bg-secondary border border-border rounded"
                value={data.syncDelay} onCommit={(value) => mutate([{ type: "set", path: ["sync-delay"], value }])} />
              <div className="flex-1" />
              <button onClick={addConfig} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加泛光</button>
            </div>

            {Object.entries(data.configs).map(([id, cfg]) => (
              <div key={id} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                  {editingId === id ? (
                    <BufferedTextInput autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      value={id} onCommit={(value) => renameConfig(id, value)} onCancel={() => setEditingId(null)} />
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
                        <BufferedNumberInput key={i} mode="integer" min={0} max={255} className="w-14 px-1 py-1 text-sm bg-secondary border border-border rounded text-center"
                          value={cfg.color?.[i] ?? 255}
                          onCommit={(value) => { const color = [...(cfg.color ?? [255, 255, 255, 200])]; color[i] = value; updateConfig(id, { color }) }} />
                      ))}
                    </div>
                  </Field>
                  <Field label="强度 (0-10)">
                    <BufferedNumberInput min={0} max={10} className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.strength ?? 5} onCommit={(value) => updateConfig(id, { strength: value })} />
                  </Field>
                  <Field label="渲染距离 (方块)">
                    <BufferedNumberInput mode="integer" min={1} max={128} className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.radius ?? 32} onCommit={(value) => updateConfig(id, { radius: value })} />
                  </Field>
                  <Field label="优先级">
                    <BufferedNumberInput mode="integer" className="w-full px-2 py-1 text-sm bg-secondary border border-border rounded"
                      value={cfg.priority ?? 1} onCommit={(value) => updateConfig(id, { priority: value })} />
                  </Field>
                </div>
              </div>
            ))}
            {Object.keys(data.configs).length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无泛光配置</div>}
          </div>
        </YamlVisualGuard>
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
