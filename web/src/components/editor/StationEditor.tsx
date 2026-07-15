import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import type { StationData, StationOptions } from "@/types"
import { safeParseYaml, updateYamlFromObject } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
import { BufferedNumberInput } from "./BufferedNumberInput"
import { Switch } from "@/components/ui/switch"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { getActionsSchema } from "@/lib/kether-language"
import { ActionsEditor } from "./ActionsEditor"
import { VariablesEditor } from "./VariablesEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface StationEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

// 硬编码 fallback（schema 未加载时使用）
const FALLBACK_EVENTS = [
  "Player Damage Post", "Player Damaged Pre", "Player Damaged Post",
  "Player Death", "Player Kill", "Player Respawn",
  "Player Join", "Player Quit", "Player Interact",
  "Player Toggle Sneak", "Player Toggle Sprint", "Player Jump", "Player Move",
  "Player Chat", "Async Player Chat", "Player Command",
  "Player Swap Hand", "Player Drop Item", "Player Pickup Item",
  "Player Consume", "Player Fish", "Player Block Break", "Player Block Place",
  "Entity Damage By Entity", "Entity Death", "Entity Spawn",
  "Orryx Player Flag Change Post", "Orryx Player Mana Change",
  "Orryx Player Spirit Change", "Orryx Player Level Change",
  "Orryx Player Job Change", "Orryx Player Skill Cast Pre",
  "Orryx Player Skill Cast Post", "Orryx Player Skill Cooldown",
  "Dragon Cache Load", "Dragon Cache Unload",
]

const PRIORITIES = ["LOWEST", "LOW", "NORMAL", "HIGH", "HIGHEST", "MONITOR"]

export function StationEditor({ content, onChange, filePath }: StationEditorProps) {
  const rawYamlRef = useRef(content)
  useEffect(() => {
    rawYamlRef.current = content
  }, [content])

  const parsed = useMemo(() => safeParseYaml<StationData>(content), [content])
  const station = useMemo<StationData>(() => parsed.ok
    ? { ...parsed.data, Options: parsed.data.Options ?? { Event: "" } }
    : { Options: { Event: "" } }, [parsed])

  const updateStation = useCallback((updater: (s: StationData) => StationData) => {
    const updated = updater(station)
    onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>))
  }, [station, onChange])

  const updateOptions = useCallback((patch: Partial<StationOptions>) => {
    updateStation((s) => ({ ...s, Options: { ...s.Options, ...patch } }))
  }, [updateStation])

  return (
    <Tabs defaultValue="options" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="options">事件配置</TabsTrigger>
        <TabsTrigger value="variables">变量</TabsTrigger>
        <TabsTrigger value="actions">Actions 脚本</TabsTrigger>
        <TabsTrigger value="refs">引用</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="options" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}><StationOptionsPanel options={station.Options} onChange={updateOptions} /></YamlVisualGuard>
      </TabsContent>

      <TabsContent value="variables" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}><VariablesEditor variables={station.Options.Variables ?? {}} onChange={(v) => updateOptions({ Variables: v })} /></YamlVisualGuard>
      </TabsContent>

      <TabsContent value="actions" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <div className="h-full"><ActionsEditor value={station.Actions ?? ""} onChange={(a) => updateStation((s) => ({ ...s, Actions: a }))} height="100%" /></div>
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="refs" className="flex-1 overflow-y-auto">
        {filePath ? <CrossRefPanel currentFile={filePath} /> : <div className="p-4 text-sm text-muted-foreground">无法分析引用。</div>}
      </TabsContent>

      <TabsContent value="yaml" className="flex-1 overflow-y-auto">
        <div className="h-full">
          <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
            options={{ fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function StationOptionsPanel({ options, onChange }: { options: StationOptions; onChange: (p: Partial<StationOptions>) => void }) {
  const [eventFilter, setEventFilter] = useState("")
  const [showEventList, setShowEventList] = useState(false)

  // 从 schema 加载 triggers，按 category 分组
  // useState + useMemo 替换为单次计算的值，避免 React Compiler 警告
  // getActionsSchema() 返回全局单例，不需要依赖项
  const [triggerGroups, allTriggerNames] = useMemo(() => {
    const schema = getActionsSchema()
    type TriggerItem = { name: string; description?: string; variables?: { name: string; type: string; description?: string }[] }
    if (schema?.triggers && schema.triggers.length > 0) {
      const groups: Record<string, TriggerItem[]> = {}
      for (const t of schema.triggers) {
        const cat = t.category || "其他"
        if (!groups[cat]) groups[cat] = []
        groups[cat].push(t)
      }
      const names = schema.triggers.map(t => t.name)
      return [groups, names] as const
    }
    return [
      { "默认": FALLBACK_EVENTS.map(name => ({ name }) as TriggerItem) } as Record<string, TriggerItem[]>,
      FALLBACK_EVENTS,
    ] as const
  }, [])

  const filteredTriggers = eventFilter
    ? allTriggerNames.filter(e => e.toLowerCase().includes(eventFilter.toLowerCase()))
    : allTriggerNames

  // 当前选中事件的变量信息
  const selectedTrigger = useMemo(() => {
    const schema = getActionsSchema()
    return schema?.triggers?.find(t => t.name === options.Event)
  }, [options.Event])

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">监听事件</label>
        <div className="relative">
          <input className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm font-mono"
            value={options.Event ?? ""}
            onChange={(e) => { onChange({ Event: e.target.value }); setEventFilter(e.target.value); setShowEventList(true) }}
            onFocus={() => { setEventFilter(options.Event ?? ""); setShowEventList(true) }}
            onBlur={() => setTimeout(() => setShowEventList(false), 200)}
            placeholder="选择或输入事件名" />
          {showEventList && filteredTriggers.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded shadow-lg max-h-64 overflow-y-auto">
              {Object.entries(triggerGroups).map(([category, triggers]) => {
                const visible = triggers.filter(t => filteredTriggers.includes(t.name))
                if (visible.length === 0) return null
                return (
                  <div key={category}>
                    <div className="px-3 py-1 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0">{category}</div>
                    {visible.map((trigger) => (
                      <button key={trigger.name}
                        className={cn("w-full text-left px-3 py-1.5 text-sm hover:bg-accent font-mono", trigger.name === options.Event && "bg-accent text-accent-foreground")}
                        onMouseDown={(e) => { e.preventDefault(); onChange({ Event: trigger.name }); setShowEventList(false) }}
                      >
                        <span>{trigger.name}</span>
                        {trigger.description && <span className="ml-2 text-xs text-muted-foreground font-sans">{trigger.description}</span>}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">可用事件变量通过 &event[字段名] 访问</p>
        {selectedTrigger?.variables && selectedTrigger.variables.length > 0 && (
          <div className="mt-2 text-xs space-y-0.5">
            <p className="text-muted-foreground font-medium">事件变量：</p>
            {selectedTrigger.variables.map((v) => (
              <div key={v.name} className="flex items-center gap-2 pl-2">
                <code className="text-blue-400">&event[{v.name}]</code>
                <span className="text-zinc-500">{v.type}</span>
                {v.description && <span className="text-muted-foreground">— {v.description}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">执行权重</label>
        <BufferedNumberInput mode="integer" className="w-32 bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={options.Weight ?? 0} onCommit={(value) => onChange({ Weight: value })} />
        <p className="text-xs text-muted-foreground mt-1">数字越大越先执行，默认 0</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">事件优先级</label>
        <Select value={(options.Priority ?? "NORMAL").toUpperCase()} onValueChange={(v) => onChange({ Priority: v })}>
          <SelectTrigger className="bg-muted border border-border rounded"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <Switch checked={options.IgnoreCancelled ?? false}
          onCheckedChange={(v) => onChange({ IgnoreCancelled: v })} />
        <span className="text-[13px] text-foreground">跳过已取消的事件</span>
      </label>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          冷却间隔 <span className="text-xs text-muted-foreground ml-2">Kether 脚本，返回 Tick 数</span>
        </label>
        <ActionsEditor value={options.BaffleAction ?? ""} onChange={(v) => onChange({ BaffleAction: v })} height="60px" />
      </div>
    </div>
  )
}
