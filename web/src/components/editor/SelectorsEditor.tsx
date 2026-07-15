import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Copy, Check } from "lucide-react"
import { safeParseYaml, updateYamlPaths, type YamlPathMutation } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
import { BufferedTextInput } from "./BufferedTextInput"
import { ActionsEditor } from "./ActionsEditor"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface SelectorsEditorProps {
  content: string
  onChange: (yaml: string) => void
}

interface SelectorEntry {
  key: string
  actions: string
  objectValue: boolean
}

export function SelectorsEditor({ content, onChange }: SelectorsEditorProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawRef = useRef(content)
  useEffect(() => {
    rawRef.current = content
  }, [content])

  const parsed = useMemo(() => safeParseYaml<Record<string, { Actions?: string } | string>>(content), [content])
  const entries = useMemo<SelectorEntry[]>(() => {
    if (!parsed.ok) return []
    return Object.entries(parsed.data).map(([key, value]) => ({
      key,
      actions: typeof value === "object" && value !== null ? (value.Actions ?? "") : String(value),
      objectValue: typeof value === "object" && value !== null,
    }))
  }, [parsed])

  const mutate = useCallback((mutations: YamlPathMutation[]) => {
    onChange(updateYamlPaths(rawRef.current, mutations))
  }, [onChange])

  const addSelector = () => {
    const key = `新选择器_${Date.now() % 1000}`
    mutate([{ type: "set", path: [key], value: { Actions: "container" } }])
    setEditingKey(key)
  }

  const removeSelector = (key: string) => mutate([{ type: "delete", path: [key] }])

  const renameSelector = (oldKey: string, newKey: string): boolean => {
    const trimmed = newKey.trim()
    if (!trimmed || (trimmed !== oldKey && entries.some((entry) => entry.key === trimmed))) return false
    mutate([{ type: "rename", path: [oldKey], newKey: trimmed }])
    setEditingKey(null)
    return true
  }

  const updateActions = (entry: SelectorEntry, actions: string) => {
    mutate([{ type: "set", path: entry.objectValue ? [entry.key, "Actions"] : [entry.key], value: actions }])
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <div className="p-4 space-y-3 max-w-4xl">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                自定义选择器，在 Kether 脚本中通过 <code className="text-zinc-300">@选择器名</code> 使用
              </div>
              <button onClick={addSelector} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">添加选择器</button>
            </div>

            {entries.map((entry) => (
              <div key={entry.key} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-0 px-3 py-1.5 bg-muted/50 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">@</span>
                  {editingKey === entry.key ? (
                    <BufferedTextInput autoFocus className="bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono w-48"
                      value={entry.key} onCommit={(value) => renameSelector(entry.key, value)} onCancel={() => setEditingKey(null)} />
                  ) : (
                    <span className="text-sm font-mono font-semibold cursor-pointer hover:text-primary"
                      onClick={() => setEditingKey(entry.key)}>{entry.key}</span>
                  )}
                  <CopyButton text={`@${entry.key}`} />
                  <div className="flex-1" />
                  <button onClick={() => removeSelector(entry.key)} className="text-xs text-red-400 hover:text-red-300">删除</button>
                </div>
                <ActionsEditor value={entry.actions} onChange={(v) => updateActions(entry, v)} height="120px" />
              </div>
            ))}
            {entries.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">暂无自定义选择器</div>}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={handleCopy} className="ml-1.5 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title={`复制 ${text}`}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
