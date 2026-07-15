import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Copy, Check } from "lucide-react"
import { safeParseYaml, updateYamlPaths, type YamlPathMutation } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
import { BufferedTextInput } from "./BufferedTextInput"
import { ActionsEditor } from "./ActionsEditor"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface PlaceholderEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

interface PlaceholderEntry {
  key: string
  script: string
}

export function PlaceholderEditor({ content, onChange }: PlaceholderEditorProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const rawYamlRef = useRef(content)
  useEffect(() => {
    rawYamlRef.current = content
  }, [content])

  const parsed = useMemo(() => safeParseYaml<Record<string, string>>(content), [content])
  const entries = useMemo<PlaceholderEntry[]>(() => {
    if (!parsed.ok) return []
    return Object.entries(parsed.data).map(([key, script]) => ({ key, script: String(script) }))
  }, [parsed])

  const mutate = useCallback((mutations: YamlPathMutation[]) => {
    onChange(updateYamlPaths(rawYamlRef.current, mutations))
  }, [onChange])

  const addEntry = () => {
    const key = `新占位符_${Date.now() % 1000}`
    mutate([{ type: "set", path: [key], value: "0" }])
    setEditingKey(key)
  }

  const removeEntry = (key: string) => mutate([{ type: "delete", path: [key] }])

  const renameEntry = (oldKey: string, newKey: string): boolean => {
    const trimmed = newKey.trim()
    if (!trimmed || (trimmed !== oldKey && entries.some((entry) => entry.key === trimmed))) return false
    mutate([{ type: "rename", path: [oldKey], newKey: trimmed }])
    setEditingKey(null)
    return true
  }

  const updateScript = (key: string, script: string) => {
    mutate([{ type: "set", path: [key], value: script }])
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
                使用方式: <code className="text-zinc-300">%orryx_键名%</code>
              </div>
              <button
                onClick={addEntry}
                className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded"
              >
                添加占位符
              </button>
            </div>

            {entries.length === 0 && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                暂无占位符，点击"添加占位符"创建
              </div>
            )}

            {entries.map((entry) => (
              <div key={entry.key} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-0 px-3 py-1.5 bg-muted/50 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">%orryx_</span>
                  {editingKey === entry.key ? (
                    <BufferedTextInput
                      autoFocus
                      className="bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono w-48"
                      value={entry.key}
                      onCommit={(value) => renameEntry(entry.key, value)}
                      onCancel={() => setEditingKey(null)}
                    />
                  ) : (
                    <span
                      className="text-sm font-mono text-foreground cursor-pointer hover:text-primary"
                      onClick={() => setEditingKey(entry.key)}
                    >
                      {entry.key}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">%</span>
                  <CopyButton text={`%orryx_${entry.key}%`} />
                  <div className="flex-1" />
                  <button
                    onClick={() => removeEntry(entry.key)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    删除
                  </button>
                </div>
                <ActionsEditor
                  value={entry.script}
                  onChange={(v) => updateScript(entry.key, v)}
                  height="60px"
                />
              </div>
            ))}
          </div>
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="yaml" className="flex-1 overflow-y-auto">
          <div className="h-full">
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={content}
              onChange={(v) => onChange(v ?? "")}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                insertSpaces: true,
                automaticLayout: true,
                padding: { top: 4 },
              }}
            />
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
    <button
      onClick={handleCopy}
      className="ml-1.5 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
      title={`复制 ${text}`}
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-400" />
        : <Copy className="w-3.5 h-3.5" />
      }
    </button>
  )
}
