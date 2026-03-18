import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface BuffsEditorProps {
  content: string
  onChange: (yaml: string) => void
}

type Tab = "visual" | "yaml"

export function BuffsEditor({ content, onChange }: BuffsEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("visual")
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawRef = useRef(content)
  rawRef.current = content

  const buffs = useMemo(() => {
    try {
      const data = parseYaml<Record<string, { Description?: string[] }>>(content)
      return Object.entries(data).map(([key, val]) => ({ key, description: val?.Description ?? [] }))
    } catch { return [] }
  }, [content])

  const save = useCallback((entries: { key: string; description: string[] }[]) => {
    const obj: Record<string, { Description: string[] }> = {}
    for (const e of entries) obj[e.key] = { Description: e.description }
    try { onChange(updateYamlFromObject(rawRef.current, obj as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml(obj)) }
  }, [onChange])

  const addBuff = () => {
    const key = `新Buff_${Date.now() % 1000}`
    save([...buffs, { key, description: ["&f描述行"] }])
    setEditingKey(key)
  }

  const removeBuff = (key: string) => save(buffs.filter((b) => b.key !== key))

  const renameBuff = (oldKey: string, newKey: string) => {
    if (!newKey.trim() || (newKey !== oldKey && buffs.some((b) => b.key === newKey))) return
    save(buffs.map((b) => (b.key === oldKey ? { ...b, key: newKey } : b)))
    setEditingKey(null)
  }

  const updateDesc = (key: string, description: string[]) => {
    save(buffs.map((b) => (b.key === key ? { ...b, description } : b)))
  }

  return (
    <div className="h-full flex flex-col">
      <TabBar active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto">
        {activeTab === "visual" && (
          <div className="p-4 space-y-3 max-w-3xl">
            <div className="flex justify-end">
              <button onClick={addBuff} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加 Buff</button>
            </div>
            {buffs.map((buff) => (
              <div key={buff.key} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                  {editingKey === buff.key ? (
                    <input autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      defaultValue={buff.key}
                      onBlur={(e) => renameBuff(buff.key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameBuff(buff.key, e.currentTarget.value); if (e.key === "Escape") setEditingKey(null) }} />
                  ) : (
                    <span className="flex-1 text-sm font-semibold cursor-pointer hover:text-primary" onClick={() => setEditingKey(buff.key)}>{buff.key}</span>
                  )}
                  <button onClick={() => removeBuff(buff.key)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                </div>
                <div className="p-3 space-y-1">
                  <label className="text-xs text-muted-foreground">描述行（每行一条，支持 {"{{ }}"} Kether 内联表达式）</label>
                  <textarea
                    className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md font-mono h-24 resize-y"
                    value={buff.description.join("\n")}
                    onChange={(e) => updateDesc(buff.key, e.target.value.split("\n"))}
                  />
                </div>
              </div>
            ))}
            {buffs.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无 Buff 配置</div>}
          </div>
        )}
        {activeTab === "yaml" && <YamlTab content={content} onChange={onChange} />}
      </div>
    </div>
  )
}

function TabBar({ active, onChange }: { active: string; onChange: (t: "visual" | "yaml") => void }) {
  return (
    <div className="flex border-b border-border bg-background shrink-0">
      {(["visual", "yaml"] as const).map((t) => (
        <button key={t} onClick={() => onChange(t)} className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
          active === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t === "visual" ? "可视化" : "YAML 源码"}
        </button>
      ))}
    </div>
  )
}

function YamlTab({ content, onChange }: { content: string; onChange: (v: string) => void }) {
  return (
    <div className="h-full">
      <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
        options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
    </div>
  )
}
