import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { ActionsEditor } from "./ActionsEditor"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import Editor from "@monaco-editor/react"

// 复用 StatusEditor 的类型（GlobalStates 和 States 结构一致）
interface StateAnimation {
  Key?: string; Duration?: string; SuccessKey?: string
  Front?: string; Rear?: string; Left?: string; Right?: string
  StartKey?: string; CastKey?: string; PressDuration?: string; CastDuration?: string
  "Start-Key"?: string; "Loop-Key"?: string; "End-Key"?: string
  "Start-Duration"?: string; "Loop-Duration"?: string; "End-Duration"?: string
}

interface StateEntry {
  Type: string; Connection?: string; Check?: string; Invincible?: string | number
  DamageType?: string; Spirit?: number; Animation: StateAnimation; Action?: string; BlockAction?: string
}

interface StateFileData {
  GlobalStates: Record<string, StateEntry>
}

const STATE_TYPES = [
  { value: "General Attack", label: "General Attack (普攻)" },
  { value: "Block", label: "Block (格挡)" },
  { value: "Dodge", label: "Dodge (闪避)" },
  { value: "Press Attack", label: "Press Attack (蓄力攻击)" },
  { value: "Vertigo", label: "Vertigo (眩晕)" },
]

interface StateFileEditorProps {
  content: string
  onChange: (yamlContent: string) => void
}

export function StateFileEditor({ content, onChange }: StateFileEditorProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const rawYamlRef = useRef(content)
  useEffect(() => {
    rawYamlRef.current = content
  }, [content])

  const data = useMemo<StateFileData>(() => {
    try { return parseYaml<StateFileData>(content) }
    catch { return { GlobalStates: {} } }
  }, [content])

  const updateData = useCallback((updater: (d: StateFileData) => StateFileData) => {
    const updated = updater(data)
    try { onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml(updated)) }
  }, [data, onChange])

  const stateNames = Object.keys(data.GlobalStates ?? {})
  const selectedState = selected && data.GlobalStates?.[selected] ? data.GlobalStates[selected] : null

  const updateState = (s: StateEntry) => {
    if (!selected) return
    updateData((d) => ({ ...d, GlobalStates: { ...d.GlobalStates, [selected]: s } }))
  }

  return (
    <Tabs defaultValue="visual" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="visual">全局状态 ({stateNames.length})</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="visual" className="flex-1 overflow-hidden flex">
        <div className="w-48 border-r border-border overflow-y-auto shrink-0 bg-muted/30">
          <div className="p-2 space-y-0.5">
            {stateNames.map((name) => (
              <button key={name} onClick={() => setSelected(name)}
                className={cn("w-full text-left px-2 py-1.5 rounded text-sm",
                  selected === name ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")}>
                <div className="flex items-center gap-2">
                  <TypeBadge type={data.GlobalStates[name].Type} />
                  <span className="font-medium truncate">{name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedState ? (
            <GlobalStatePanel name={selected!} state={selectedState} onChange={updateState} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">从左侧选择一个全局状态进行编辑</div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="yaml" className="flex-1 overflow-y-auto">
        <div className="flex-1">
          <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
            options={{ fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function GlobalStatePanel({ name, state, onChange }: { name: string; state: StateEntry; onChange: (s: StateEntry) => void }) {
  const update = (patch: Partial<StateEntry>) => onChange({ ...state, ...patch })
  const updateAnim = (patch: Partial<StateAnimation>) => onChange({ ...state, Animation: { ...state.Animation, ...patch } })
  const type = state.Type?.toUpperCase()

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center gap-3"><TypeBadge type={state.Type} /><h3 className="text-lg font-medium">{name}</h3></div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">类型 (Type)</label>
        <Select value={state.Type} onValueChange={(v) => update({ Type: v })}>
          <SelectTrigger className="input-base"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold border-b border-border pb-1">动画 (Animation)</h4>
        <div className="grid grid-cols-2 gap-3">
          <AnimationFields type={type} animation={state.Animation ?? {}} onChange={updateAnim} />
        </div>
      </div>

      {/* 时间轴预览（Vertigo 专用） */}
      {type === "VERTIGO" && <TimelinePreview animation={state.Animation} />}

      {state.Action !== undefined && (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold border-b border-border pb-1">Action 脚本</h4>
          <ActionsEditor value={state.Action ?? ""} onChange={(v) => update({ Action: v })} height="150px" />
        </div>
      )}
    </div>
  )
}

function AnimationFields({ type, animation, onChange }: { type: string; animation: StateAnimation; onChange: (p: Partial<StateAnimation>) => void }) {
  switch (type) {
    case "GENERAL ATTACK":
      return <>
        <Field label="动画名 (Key)"><input className="input-base" value={animation.Key ?? ""} onChange={(e) => onChange({ Key: e.target.value })} /></Field>
        <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={animation.Duration ?? ""} onChange={(e) => onChange({ Duration: e.target.value })} /></Field>
      </>
    case "BLOCK":
      return <>
        <Field label="格挡动画 (Key)"><input className="input-base" value={animation.Key ?? ""} onChange={(e) => onChange({ Key: e.target.value })} /></Field>
        <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={animation.Duration ?? ""} onChange={(e) => onChange({ Duration: e.target.value })} /></Field>
        <Field label="成功动画 (SuccessKey)"><input className="input-base" value={animation.SuccessKey ?? ""} onChange={(e) => onChange({ SuccessKey: e.target.value })} /></Field>
      </>
    case "DODGE":
      return <>
        <Field label="前 (Front)"><input className="input-base" value={animation.Front ?? ""} onChange={(e) => onChange({ Front: e.target.value })} /></Field>
        <Field label="后 (Rear)"><input className="input-base" value={animation.Rear ?? ""} onChange={(e) => onChange({ Rear: e.target.value })} /></Field>
        <Field label="左 (Left)"><input className="input-base" value={animation.Left ?? ""} onChange={(e) => onChange({ Left: e.target.value })} /></Field>
        <Field label="右 (Right)"><input className="input-base" value={animation.Right ?? ""} onChange={(e) => onChange({ Right: e.target.value })} /></Field>
        <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={animation.Duration ?? ""} onChange={(e) => onChange({ Duration: e.target.value })} /></Field>
      </>
    case "PRESS ATTACK":
      return <>
        <Field label="蓄力动画 (StartKey)"><input className="input-base" value={animation.StartKey ?? ""} onChange={(e) => onChange({ StartKey: e.target.value })} /></Field>
        <Field label="释放动画 (CastKey)"><input className="input-base" value={animation.CastKey ?? ""} onChange={(e) => onChange({ CastKey: e.target.value })} /></Field>
        <Field label="最大蓄力时长 (PressDuration)" hint="tick"><input className="input-base" value={animation.PressDuration ?? ""} onChange={(e) => onChange({ PressDuration: e.target.value })} /></Field>
        <Field label="释放时长 (CastDuration)" hint="tick"><input className="input-base" value={animation.CastDuration ?? ""} onChange={(e) => onChange({ CastDuration: e.target.value })} /></Field>
      </>
    case "VERTIGO":
      return <>
        <Field label="开始动画 (Start-Key)"><input className="input-base" value={animation["Start-Key"] ?? ""} onChange={(e) => onChange({ "Start-Key": e.target.value })} /></Field>
        <Field label="循环动画 (Loop-Key)"><input className="input-base" value={animation["Loop-Key"] ?? ""} onChange={(e) => onChange({ "Loop-Key": e.target.value })} /></Field>
        <Field label="起身动画 (End-Key)"><input className="input-base" value={animation["End-Key"] ?? ""} onChange={(e) => onChange({ "End-Key": e.target.value })} /></Field>
        <Field label="开始时长 (Start-Duration)" hint="tick"><input className="input-base" value={animation["Start-Duration"] ?? ""} onChange={(e) => onChange({ "Start-Duration": e.target.value })} /></Field>
        <Field label="循环时长 (Loop-Duration)" hint="tick"><input className="input-base" value={animation["Loop-Duration"] ?? ""} onChange={(e) => onChange({ "Loop-Duration": e.target.value })} /></Field>
        <Field label="起身时长 (End-Duration)" hint="tick"><input className="input-base" value={animation["End-Duration"] ?? ""} onChange={(e) => onChange({ "End-Duration": e.target.value })} /></Field>
      </>
    default:
      return <div className="col-span-2 text-xs text-muted-foreground">未知类型: {type}</div>
  }
}

function TimelinePreview({ animation }: { animation?: StateAnimation }) {
  const s = parseInt(animation?.["Start-Duration"] ?? "0") || 0
  const l = parseInt(animation?.["Loop-Duration"] ?? "0") || 0
  const e = parseInt(animation?.["End-Duration"] ?? "0") || 0
  const total = s + l + e
  if (total === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold border-b border-border pb-1">时间轴</h4>
      <div className="flex h-8 rounded overflow-hidden border border-border">
        {[{ label: "开始", dur: s, color: "bg-yellow-500/60" }, { label: "循环", dur: l, color: "bg-blue-500/60" }, { label: "起身", dur: e, color: "bg-green-500/60" }]
          .filter(seg => seg.dur > 0)
          .map((seg) => (
            <div key={seg.label} className={cn("flex items-center justify-center text-xs font-medium", seg.color)} style={{ width: `${(seg.dur / total) * 100}%` }}>
              {seg.label} ({seg.dur}t)
            </div>
          ))}
      </div>
      <div className="text-xs text-muted-foreground">总时长: {total}t ({(total / 20).toFixed(1)}s)</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}{hint && <span className="ml-1 text-zinc-600">{hint}</span>}</label>{children}</div>
}
function TypeBadge({ type }: { type: string }) {
  const t = type?.toUpperCase()
  const c: Record<string, string> = { "GENERAL ATTACK": "bg-red-500/20 text-red-400", "BLOCK": "bg-blue-500/20 text-blue-400", "DODGE": "bg-green-500/20 text-green-400", "PRESS ATTACK": "bg-orange-500/20 text-orange-400", "VERTIGO": "bg-purple-500/20 text-purple-400" }
  const l: Record<string, string> = { "GENERAL ATTACK": "攻", "BLOCK": "挡", "DODGE": "闪", "PRESS ATTACK": "蓄", "VERTIGO": "晕" }
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", c[t] ?? "bg-zinc-500/20 text-zinc-400")}>{l[t] ?? type?.charAt(0)}</span>
}
