import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { safeParseYaml, updateYamlPaths, type YamlPathMutation } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
import { BufferedTextInput } from "./BufferedTextInput"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface BuffsEditorProps {
  content: string
  onChange: (yaml: string) => void
}

export function BuffsEditor({ content, onChange }: BuffsEditorProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawRef = useRef(content)
  useEffect(() => {
    rawRef.current = content
  }, [content])

  const parsed = useMemo(() => safeParseYaml<Record<string, { Description?: string[] }>>(content), [content])
  const buffs = useMemo(() => {
    if (!parsed.ok) return []
    return Object.entries(parsed.data).map(([key, value]) => ({ key, description: value?.Description ?? [] }))
  }, [parsed])

  const mutate = useCallback((mutations: YamlPathMutation[]) => {
    onChange(updateYamlPaths(rawRef.current, mutations))
  }, [onChange])

  const addBuff = () => {
    const key = `新Buff_${Date.now() % 1000}`
    mutate([{ type: "set", path: [key], value: { Description: ["&f描述行"] } }])
    setEditingKey(key)
  }

  const removeBuff = (key: string) => mutate([{ type: "delete", path: [key] }])

  const renameBuff = (oldKey: string, newKey: string): boolean => {
    const trimmed = newKey.trim()
    if (!trimmed || (trimmed !== oldKey && buffs.some((buff) => buff.key === trimmed))) return false
    mutate([{ type: "rename", path: [oldKey], newKey: trimmed }])
    setEditingKey(null)
    return true
  }

  const updateDesc = (key: string, description: string[]) => {
    mutate([{ type: "set", path: [key, "Description"], value: description }])
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <div className="p-4 space-y-3 max-w-3xl">
            <div className="flex justify-end">
              <button onClick={addBuff} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加 Buff</button>
            </div>
            {buffs.map((buff) => (
              <div key={buff.key} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                  {editingKey === buff.key ? (
                    <BufferedTextInput autoFocus className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono"
                      value={buff.key} onCommit={(value) => renameBuff(buff.key, value)} onCancel={() => setEditingKey(null)} />
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
