import { useState, useMemo, useCallback, useRef } from "react"
import { Copy, Check } from "lucide-react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
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
  rawYamlRef.current = content

  const entries = useMemo<PlaceholderEntry[]>(() => {
    try {
      const data = parseYaml<Record<string, string>>(content)
      return Object.entries(data).map(([key, script]) => ({ key, script: String(script) }))
    } catch {
      return []
    }
  }, [content])

  const updateEntries = useCallback((newEntries: PlaceholderEntry[]) => {
    const obj: Record<string, string> = {}
    for (const e of newEntries) obj[e.key] = e.script
    try {
      onChange(updateYamlFromObject(rawYamlRef.current, obj as unknown as Record<string, unknown>))
    } catch {
      onChange(stringifyYaml(obj))
    }
  }, [onChange])

  const addEntry = () => {
    const key = `新占位符_${Date.now() % 1000}`
    updateEntries([...entries, { key, script: "0" }])
    setEditingKey(key)
  }

  const removeEntry = (key: string) => {
    updateEntries(entries.filter((e) => e.key !== key))
  }

  const renameEntry = (oldKey: string, newKey: string) => {
    if (!newKey.trim() || (newKey !== oldKey && entries.some((e) => e.key === newKey))) return
    updateEntries(entries.map((e) => (e.key === oldKey ? { ...e, key: newKey } : e)))
    setEditingKey(null)
  }

  const updateScript = (key: string, script: string) => {
    updateEntries(entries.map((e) => (e.key === key ? { ...e, script } : e)))
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">可视化</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-y-auto">
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
                    <input
                      autoFocus
                      className="bg-secondary border border-border rounded px-2 py-0.5 text-sm font-mono w-48"
                      defaultValue={entry.key}
                      onBlur={(e) => renameEntry(entry.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameEntry(entry.key, e.currentTarget.value)
                        if (e.key === "Escape") setEditingKey(null)
                      }}
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
