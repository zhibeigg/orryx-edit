import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface NpcEditorProps {
  content: string
  onChange: (yaml: string) => void
}

interface NpcConfig {
  name: string
  system: string
  temperature: number
  maxTokens: number
  model: string
}

export function NpcEditor({ content, onChange }: NpcEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const rawRef = useRef(content)
  useEffect(() => {
    rawRef.current = content
  }, [content])

  const npcs = useMemo(() => {
    try { return parseYaml<Record<string, NpcConfig>>(content) }
    catch { return {} }
  }, [content])

  const save = useCallback((data: Record<string, NpcConfig>) => {
    try { onChange(updateYamlFromObject(rawRef.current, data as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml(data)) }
  }, [onChange])

  const addNpc = () => {
    const id = `npc_${Date.now() % 10000}`
    save({ ...npcs, [id]: { name: "新 NPC", system: "你是一个NPC", temperature: 1.0, maxTokens: 64, model: "gpt-4o-mini" } })
    setEditingId(id)
    setExpandedId(id)
  }

  const removeNpc = (id: string) => {
    const { [id]: _removed, ...rest } = npcs
    void _removed
    save(rest)
  }

  const renameNpc = (oldId: string, newId: string) => {
    if (!newId.trim() || (newId !== oldId && newId in npcs)) return
    const entries = Object.entries(npcs).map(([k, v]) => [k === oldId ? newId : k, v])
    save(Object.fromEntries(entries) as Record<string, NpcConfig>)
    setEditingId(null)
  }

  const updateNpc = (id: string, patch: Partial<NpcConfig>) => {
    save({ ...npcs, [id]: { ...npcs[id], ...patch } })
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-3 max-w-3xl">
            <div className="flex justify-end">
              <button onClick={addNpc} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加 NPC</button>
            </div>

            {Object.entries(npcs).map(([id, npc]) => (
              <div key={id} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border cursor-pointer"
                  onClick={() => setExpandedId(expandedId === id ? null : id)}>
                  <span className="text-xs text-muted-foreground">{expandedId === id ? "▼" : "▶"}</span>
                  {editingId === id ? (
                    <input autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      defaultValue={id} onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => renameNpc(id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameNpc(id, e.currentTarget.value); if (e.key === "Escape") setEditingId(null) }} />
                  ) : (
                    <span className="flex-1 text-sm font-semibold" onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id) }}>{id}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{npc.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeNpc(id) }} className="text-xs text-red-400 hover:text-red-300">删除</button>
                </div>

                {expandedId === id && (
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="显示名称">
                        <input className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                          value={npc.name ?? ""} onChange={(e) => updateNpc(id, { name: e.target.value })} />
                      </Field>
                      <Field label="模型">
                        <input className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                          value={npc.model ?? ""} onChange={(e) => updateNpc(id, { model: e.target.value })} placeholder="gpt-4o-mini" />
                      </Field>
                      <Field label="温度 (temperature)">
                        <input type="number" step={0.1} min={0} max={2} className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                          value={npc.temperature ?? 1.0} onChange={(e) => updateNpc(id, { temperature: parseFloat(e.target.value) || 1.0 })} />
                      </Field>
                      <Field label="最大 Tokens">
                        <input type="number" min={1} className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded"
                          value={npc.maxTokens ?? 64} onChange={(e) => updateNpc(id, { maxTokens: parseInt(e.target.value) || 64 })} />
                      </Field>
                    </div>
                    <Field label="System Prompt">
                      <textarea className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md font-mono h-32 resize-y"
                        value={npc.system ?? ""} onChange={(e) => updateNpc(id, { system: e.target.value })} />
                    </Field>
                  </div>
                )}
              </div>
            ))}
            {Object.keys(npcs).length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无 NPC 配置</div>}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}
