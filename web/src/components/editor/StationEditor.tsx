import { useState, useMemo, useCallback, useRef } from "react"
import type { StationData, StationOptions } from "@/types"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { ActionsEditor } from "./ActionsEditor"
import { VariablesEditor } from "./VariablesEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface StationEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

type Tab = "options" | "variables" | "actions" | "refs" | "yaml"

const EVENTS = [
  "Player Damage Post",
  "Player Damaged Pre",
  "Player Damaged Post",
  "Player Death",
  "Player Kill",
  "Player Respawn",
  "Player Join",
  "Player Quit",
  "Player Interact",
  "Player Toggle Sneak",
  "Player Toggle Sprint",
  "Player Jump",
  "Player Move",
  "Player Chat",
  "Async Player Chat",
  "Player Command",
  "Player Swap Hand",
  "Player Drop Item",
  "Player Pickup Item",
  "Player Consume",
  "Player Fish",
  "Player Block Break",
  "Player Block Place",
  "Entity Damage By Entity",
  "Entity Death",
  "Entity Spawn",
  "Orryx Player Flag Change Post",
  "Orryx Player Mana Change",
  "Orryx Player Spirit Change",
  "Orryx Player Level Change",
  "Orryx Player Job Change",
  "Orryx Player Skill Cast Pre",
  "Orryx Player Skill Cast Post",
  "Orryx Player Skill Cooldown",
  "Dragon Cache Load",
  "Dragon Cache Unload",
]

const PRIORITIES = ["LOWEST", "LOW", "NORMAL", "HIGH", "HIGHEST", "MONITOR"]

export function StationEditor({ content, onChange, filePath }: StationEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("options")
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const station = useMemo<StationData>(() => {
    try {
      return parseYaml<StationData>(content)
    } catch {
      return { Options: { Event: "" } }
    }
  }, [content])

  const updateStation = useCallback((updater: (s: StationData) => StationData) => {
    const updated = updater(station)
    try {
      const newYaml = updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>)
      onChange(newYaml)
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [station, onChange])

  const updateOptions = useCallback((patch: Partial<StationOptions>) => {
    updateStation((s) => ({ ...s, Options: { ...s.Options, ...patch } }))
  }, [updateStation])

  const tabs: { id: Tab; label: string }[] = [
    { id: "options", label: "事件配置" },
    { id: "variables", label: "变量" },
    { id: "actions", label: "Actions 脚本" },
    { id: "refs", label: "引用" },
    { id: "yaml", label: "YAML 源码" },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {activeTab === "options" && (
            <StationOptionsPanel options={station.Options} onChange={updateOptions} />
          )}

          {activeTab === "variables" && (
            <VariablesEditor
              variables={station.Options.Variables ?? {}}
              onChange={(variables) => updateOptions({ Variables: variables })}
            />
          )}

          {activeTab === "actions" && (
            <div className="h-full">
              <ActionsEditor
                value={station.Actions ?? ""}
                onChange={(actions) => updateStation((s) => ({ ...s, Actions: actions }))}
                height="100%"
              />
            </div>
          )}

          {activeTab === "refs" && filePath && <CrossRefPanel currentFile={filePath} />}
          {activeTab === "refs" && !filePath && (
            <div className="p-4 text-sm text-muted-foreground">无法分析引用：未知文件路径。</div>
          )}

          {activeTab === "yaml" && (
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
          )}
        </div>
      </div>
    </div>
  )
}

// ---- 事件配置面板 ----
function StationOptionsPanel({ options, onChange }: { options: StationOptions; onChange: (p: Partial<StationOptions>) => void }) {
  const [eventFilter, setEventFilter] = useState("")
  const [showEventList, setShowEventList] = useState(false)

  const filteredEvents = EVENTS.filter((e) =>
    e.toLowerCase().includes(eventFilter.toLowerCase())
  )

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      {/* 事件选择 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">监听事件</label>
        <div className="relative">
          <input
            className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm font-mono"
            value={options.Event ?? ""}
            onChange={(e) => {
              onChange({ Event: e.target.value })
              setEventFilter(e.target.value)
              setShowEventList(true)
            }}
            onFocus={() => {
              setEventFilter(options.Event ?? "")
              setShowEventList(true)
            }}
            onBlur={() => setTimeout(() => setShowEventList(false), 200)}
            placeholder="选择或输入事件名"
          />
          {showEventList && filteredEvents.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded shadow-lg max-h-48 overflow-y-auto">
              {filteredEvents.map((event) => (
                <button
                  key={event}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-sm hover:bg-accent font-mono",
                    event === options.Event && "bg-accent text-accent-foreground"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange({ Event: event })
                    setShowEventList(false)
                  }}
                >
                  {event}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          可用事件变量通过 &event[字段名] 访问
        </p>
      </div>

      {/* 权重 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">执行权重</label>
        <input
          type="number"
          className="w-32 bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={options.Weight ?? 0}
          onChange={(e) => onChange({ Weight: parseInt(e.target.value) || 0 })}
        />
        <p className="text-xs text-muted-foreground mt-1">数字越大越先执行，默认 0</p>
      </div>

      {/* 优先级 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">事件优先级</label>
        <select
          className="bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={(options.Priority ?? "NORMAL").toUpperCase()}
          onChange={(e) => onChange({ Priority: e.target.value })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* 忽略已取消事件 */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="ignoreCancelled"
          checked={options.IgnoreCancelled ?? false}
          onChange={(e) => onChange({ IgnoreCancelled: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="ignoreCancelled" className="text-sm text-foreground">
          跳过已取消的事件
        </label>
      </div>

      {/* 冷却脚本 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          冷却间隔
          <span className="text-xs text-muted-foreground ml-2">Kether 脚本，返回 Tick 数</span>
        </label>
        <ActionsEditor
          value={options.BaffleAction ?? ""}
          onChange={(v) => onChange({ BaffleAction: v })}
          height="60px"
        />
      </div>
    </div>
  )
}
