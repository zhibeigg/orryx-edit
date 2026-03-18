import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { ActionsEditor } from "./ActionsEditor"
import { Switch } from "@/components/ui/switch"
import { CrossRefPanel } from "./CrossRefPanel"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

// ---- 完整类型定义（基于源码） ----
interface StatusOptions {
  Condition?: string
  CancelHeldEventWhenPlaying?: boolean
  Controller?: string
  AnimationState?: string
  CancelBukkitAttack?: boolean
  AttackSpeed?: string
  Armourers?: string[]
}

interface StateAnimation {
  // General Attack
  Key?: string
  Duration?: string
  // Block
  SuccessKey?: string
  // Dodge
  Front?: string
  Rear?: string
  Left?: string
  Right?: string
  // Press Attack
  StartKey?: string
  CastKey?: string
  PressDuration?: string
  CastDuration?: string
  // Vertigo
  "Start-Key"?: string
  "Loop-Key"?: string
  "End-Key"?: string
  "Start-Duration"?: string
  "Loop-Duration"?: string
  "End-Duration"?: string
}

interface StateEntry {
  Type: string
  Connection?: string
  Check?: string
  Invincible?: string | number
  DamageType?: string
  Spirit?: number
  Animation: StateAnimation
  Action?: string
  BlockAction?: string
}

interface StatusData {
  Options: StatusOptions
  States: Record<string, StateEntry>
  Action?: string
}

const STATE_TYPES = [
  { value: "General Attack", label: "General Attack (普攻)" },
  { value: "Block", label: "Block (格挡)" },
  { value: "Dodge", label: "Dodge (闪避)" },
  { value: "Press Attack", label: "Press Attack (蓄力攻击)" },
  { value: "Vertigo", label: "Vertigo (眩晕)" },
]

const DAMAGE_TYPES = ["PHYSICS", "MAGIC", "FIRE", "REAL"]

interface StatusEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

export function StatusEditor({ content, onChange, filePath }: StatusEditorProps) {
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const data = useMemo<StatusData>(() => {
    try { return parseYaml<StatusData>(content) }
    catch { return { Options: {}, States: {}, Action: "" } }
  }, [content])

  const updateData = useCallback((updater: (d: StatusData) => StatusData) => {
    const updated = updater(data)
    try { onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>)) }
    catch { onChange(stringifyYaml(updated)) }
  }, [data, onChange])

  const stateNames = Object.keys(data.States ?? {})

  return (
    <Tabs defaultValue="overview" className="h-full flex flex-col">
      <TabsList>
        <TabsTrigger value="overview">总览</TabsTrigger>
        <TabsTrigger value="states">状态 ({stateNames.length})</TabsTrigger>
        <TabsTrigger value="dispatch">输入分发</TabsTrigger>
        <TabsTrigger value="refs">引用</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex-1 overflow-y-auto">
        <OverviewPanel data={data} stateNames={stateNames} onChange={(opts) => updateData((d) => ({ ...d, Options: opts }))} />
      </TabsContent>

      <TabsContent value="states" className="flex-1 overflow-hidden flex">
        <div className="w-52 border-r border-border overflow-y-auto shrink-0 bg-muted/30">
          <div className="p-2 space-y-0.5">
            {stateNames.map((name) => (
              <button key={name} onClick={() => setSelectedState(name)}
                className={cn("w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2",
                  selectedState === name ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")}>
                <TypeBadge type={data.States[name].Type} />
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selectedState && data.States[selectedState] ? (
            <StatePanel
              name={selectedState}
              state={data.States[selectedState]}
              onChange={(s) => updateData((d) => ({ ...d, States: { ...d.States, [selectedState]: s } }))}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">从左侧选择一个状态</div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="dispatch" className="flex-1 overflow-y-auto">
        <div className="h-full flex flex-col">
          <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
            输入分发脚本 — 可用变量: &input (按键输入)。用 running "状态名" 切换状态
          </div>
          <div className="flex-1"><ActionsEditor value={data.Action ?? ""} onChange={(v) => updateData((d) => ({ ...d, Action: v }))} height="100%" /></div>
        </div>
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

// ---- 总览面板 ----
function OverviewPanel({ data, stateNames, onChange }: { data: StatusData; stateNames: string[]; onChange: (o: StatusOptions) => void }) {
  const opts = data.Options
  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <Section title="全局配置">
        <div className="grid grid-cols-2 gap-3">
          <Field label="控制器 (Controller)" hint="龙核动画控制器名">
            <input className="input-base" value={opts.Controller ?? ""} onChange={(e) => onChange({ ...opts, Controller: e.target.value })} />
          </Field>
          <Field label="动作状态 (AnimationState)" hint="萌芽动作状态名">
            <input className="input-base" value={opts.AnimationState ?? ""} onChange={(e) => onChange({ ...opts, AnimationState: e.target.value })} />
          </Field>
          <Field label="条件 (Condition)" hint="Kether → Boolean">
            <input className="input-base" value={opts.Condition ?? ""} onChange={(e) => onChange({ ...opts, Condition: e.target.value })} />
          </Field>
          <Field label="攻速公式 (AttackSpeed)" hint="Kether → Float，默认 1.0">
            <input className="input-base" value={opts.AttackSpeed ?? ""} onChange={(e) => onChange({ ...opts, AttackSpeed: e.target.value })} />
          </Field>
        </div>
        <div className="flex gap-4">
          <Toggle label="禁止滚轮切换 (CancelHeldEventWhenPlaying)" checked={opts.CancelHeldEventWhenPlaying ?? true} onChange={(v) => onChange({ ...opts, CancelHeldEventWhenPlaying: v })} />
          <Toggle label="取消原版攻击 (CancelBukkitAttack)" checked={opts.CancelBukkitAttack ?? false} onChange={(v) => onChange({ ...opts, CancelBukkitAttack: v })} />
        </div>
        <Field label="时装皮肤 (Armourers)" hint="逗号分隔，支持变量">
          <input className="input-base" value={(opts.Armourers ?? []).join(", ")}
            onChange={(e) => onChange({ ...opts, Armourers: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="皮肤1, 皮肤2" />
        </Field>
      </Section>

      <Section title="状态流程图">
        {STATE_TYPES.map(({ value: type, label }) => {
          const filtered = stateNames.filter((n) => data.States[n]?.Type?.toUpperCase() === type.toUpperCase())
          if (filtered.length === 0) return null
          return (
            <div key={type}>
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <div className="flex flex-wrap gap-2">
                {filtered.map((name) => {
                  const s = data.States[name]
                  return (
                    <div key={name} className="border border-border rounded px-3 py-2 bg-muted/30 text-sm space-y-1 min-w-[160px]">
                      <div className="flex items-center gap-2"><TypeBadge type={s.Type} /><span className="font-medium">{name}</span></div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {s.Animation?.Duration && <div>时长: {s.Animation.Duration}t</div>}
                        {s.Connection && <div>衔接: {s.Connection}t</div>}
                        {s.Invincible && <div>无敌: {String(s.Invincible)}t</div>}
                        {s.Spirit !== undefined && s.Spirit > 0 && <div>精力: {s.Spirit}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </Section>

      <Section title="状态转换规则">
        <div className="text-xs text-muted-foreground space-y-1">
          <p>普攻 → 可衔接: 闪避、格挡、普攻(窗口内)、蓄力攻击(窗口内)、技能</p>
          <p>蓄力攻击 → 释放后可衔接: 闪避、格挡、普攻(窗口内)、蓄力攻击(窗口内)、技能</p>
          <p>格挡 → 可衔接: 闪避、技能</p>
          <p>闪避 → 可衔接: 技能、闪避(窗口内)</p>
          <p>眩晕/技能 → 不可主动衔接</p>
          <p>所有状态 → 非霸体时可被眩晕打断</p>
        </div>
      </Section>
    </div>
  )
}

// ---- 单状态编辑面板 ----
function StatePanel({ name, state, onChange }: { name: string; state: StateEntry; onChange: (s: StateEntry) => void }) {
  const update = (patch: Partial<StateEntry>) => onChange({ ...state, ...patch })
  const updateAnim = (patch: Partial<StateAnimation>) => onChange({ ...state, Animation: { ...state.Animation, ...patch } })
  const type = state.Type?.toUpperCase()
  const isBlock = type === "BLOCK"
  const isDodge = type === "DODGE"
  const isPress = type === "PRESS ATTACK"
  const isVertigo = type === "VERTIGO"
  const isGeneral = type === "GENERAL ATTACK"
  const hasConnection = isGeneral || isDodge || isPress

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3"><TypeBadge type={state.Type} /><h3 className="text-lg font-medium">{name}</h3></div>

      <Section title="基础属性">
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型 (Type)">
            <select className="input-base" value={state.Type} onChange={(e) => update({ Type: e.target.value })}>
              {STATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          {hasConnection && (
            <Field label="衔接窗口 (Connection)" hint="起始tick-结束tick">
              <input className="input-base" value={state.Connection ?? ""} onChange={(e) => update({ Connection: e.target.value })} placeholder="8-16" />
            </Field>
          )}

          {isBlock && (
            <>
              <Field label="格挡检测窗口 (Check)" hint="起始tick-结束tick">
                <input className="input-base" value={state.Check ?? ""} onChange={(e) => update({ Check: e.target.value })} placeholder="0-10" />
              </Field>
              <Field label="格挡成功无敌时长 (Invincible)" hint="tick，×50=ms">
                <input className="input-base" type="number" value={state.Invincible ?? 0} onChange={(e) => update({ Invincible: e.target.value })} />
              </Field>
              <Field label="可格挡伤害类型 (DamageType)">
                <select className="input-base" value={state.DamageType ?? "PHYSICS"} onChange={(e) => update({ DamageType: e.target.value })}>
                  {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </>
          )}

          {isDodge && (
            <Field label="无敌帧窗口 (Invincible)" hint="起始tick-结束tick">
              <input className="input-base" value={String(state.Invincible ?? "")} onChange={(e) => update({ Invincible: e.target.value })} placeholder="0-10" />
            </Field>
          )}

          {(isBlock || isDodge) && (
            <Field label="精力消耗 (Spirit)">
              <input className="input-base" type="number" value={state.Spirit ?? 0} onChange={(e) => update({ Spirit: parseFloat(e.target.value) || 0 })} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="动画 (Animation)">
        <div className="grid grid-cols-2 gap-3">
          {/* General Attack */}
          {isGeneral && (
            <>
              <Field label="动画名 (Key)"><input className="input-base" value={state.Animation?.Key ?? ""} onChange={(e) => updateAnim({ Key: e.target.value })} /></Field>
              <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={state.Animation?.Duration ?? ""} onChange={(e) => updateAnim({ Duration: e.target.value })} /></Field>
            </>
          )}

          {/* Block */}
          {isBlock && (
            <>
              <Field label="格挡动画 (Key)"><input className="input-base" value={state.Animation?.Key ?? ""} onChange={(e) => updateAnim({ Key: e.target.value })} /></Field>
              <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={state.Animation?.Duration ?? ""} onChange={(e) => updateAnim({ Duration: e.target.value })} /></Field>
              <Field label="成功动画 (SuccessKey)"><input className="input-base" value={state.Animation?.SuccessKey ?? ""} onChange={(e) => updateAnim({ SuccessKey: e.target.value })} /></Field>
            </>
          )}

          {/* Dodge */}
          {isDodge && (
            <>
              <Field label="前 (Front)"><input className="input-base" value={state.Animation?.Front ?? ""} onChange={(e) => updateAnim({ Front: e.target.value })} /></Field>
              <Field label="后 (Rear)"><input className="input-base" value={state.Animation?.Rear ?? ""} onChange={(e) => updateAnim({ Rear: e.target.value })} /></Field>
              <Field label="左 (Left)"><input className="input-base" value={state.Animation?.Left ?? ""} onChange={(e) => updateAnim({ Left: e.target.value })} /></Field>
              <Field label="右 (Right)"><input className="input-base" value={state.Animation?.Right ?? ""} onChange={(e) => updateAnim({ Right: e.target.value })} /></Field>
              <Field label="时长 (Duration)" hint="tick"><input className="input-base" value={state.Animation?.Duration ?? ""} onChange={(e) => updateAnim({ Duration: e.target.value })} /></Field>
            </>
          )}

          {/* Press Attack */}
          {isPress && (
            <>
              <Field label="蓄力动画 (StartKey)"><input className="input-base" value={state.Animation?.StartKey ?? ""} onChange={(e) => updateAnim({ StartKey: e.target.value })} /></Field>
              <Field label="释放动画 (CastKey)"><input className="input-base" value={state.Animation?.CastKey ?? ""} onChange={(e) => updateAnim({ CastKey: e.target.value })} /></Field>
              <Field label="最大蓄力时长 (PressDuration)" hint="tick"><input className="input-base" value={state.Animation?.PressDuration ?? ""} onChange={(e) => updateAnim({ PressDuration: e.target.value })} /></Field>
              <Field label="释放时长 (CastDuration)" hint="tick"><input className="input-base" value={state.Animation?.CastDuration ?? ""} onChange={(e) => updateAnim({ CastDuration: e.target.value })} /></Field>
            </>
          )}

          {/* Vertigo */}
          {isVertigo && (
            <>
              <Field label="开始动画 (Start-Key)"><input className="input-base" value={state.Animation?.["Start-Key"] ?? ""} onChange={(e) => updateAnim({ "Start-Key": e.target.value })} /></Field>
              <Field label="循环动画 (Loop-Key)"><input className="input-base" value={state.Animation?.["Loop-Key"] ?? ""} onChange={(e) => updateAnim({ "Loop-Key": e.target.value })} /></Field>
              <Field label="起身动画 (End-Key)"><input className="input-base" value={state.Animation?.["End-Key"] ?? ""} onChange={(e) => updateAnim({ "End-Key": e.target.value })} /></Field>
              <Field label="开始时长 (Start-Duration)" hint="tick"><input className="input-base" value={state.Animation?.["Start-Duration"] ?? ""} onChange={(e) => updateAnim({ "Start-Duration": e.target.value })} /></Field>
              <Field label="循环时长 (Loop-Duration)" hint="tick"><input className="input-base" value={state.Animation?.["Loop-Duration"] ?? ""} onChange={(e) => updateAnim({ "Loop-Duration": e.target.value })} /></Field>
              <Field label="起身时长 (End-Duration)" hint="tick"><input className="input-base" value={state.Animation?.["End-Duration"] ?? ""} onChange={(e) => updateAnim({ "End-Duration": e.target.value })} /></Field>
            </>
          )}
        </div>
      </Section>

      <Section title="Action 脚本">
        <div className="text-xs text-muted-foreground mb-1">
          可用变量:
          {isGeneral && " &attackSpeed (攻速倍率)"}
          {isPress && " &attackSpeed (攻速倍率), &pressTick (蓄力tick数)"}
          {isBlock && " (BlockAction 中可用 &event)"}
        </div>
        <ActionsEditor value={state.Action ?? ""} onChange={(v) => update({ Action: v })} height="200px" />
      </Section>

      {isBlock && (
        <Section title="格挡成功脚本 (BlockAction)">
          <div className="text-xs text-muted-foreground mb-1">可用变量: &event (OrryxDamageEvents.Pre 伤害事件对象)</div>
          <ActionsEditor value={state.BlockAction ?? ""} onChange={(v) => update({ BlockAction: v })} height="150px" />
        </Section>
      )}
    </div>
  )
}

// ---- 通用组件 ----
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-3"><h3 className="text-sm font-semibold border-b border-border pb-1">{title}</h3>{children}</div>
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}{hint && <span className="ml-1 text-zinc-600">{hint}</span>}</label>{children}</div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-[13px] cursor-pointer"><Switch checked={checked} onCheckedChange={onChange} /><span>{label}</span></label>
}
function TypeBadge({ type }: { type: string }) {
  const t = type?.toUpperCase()
  const c: Record<string, string> = { "GENERAL ATTACK": "bg-red-500/20 text-red-400", "BLOCK": "bg-blue-500/20 text-blue-400", "DODGE": "bg-green-500/20 text-green-400", "PRESS ATTACK": "bg-orange-500/20 text-orange-400", "VERTIGO": "bg-purple-500/20 text-purple-400" }
  const l: Record<string, string> = { "GENERAL ATTACK": "攻", "BLOCK": "挡", "DODGE": "闪", "PRESS ATTACK": "蓄", "VERTIGO": "晕" }
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", c[t] ?? "bg-zinc-500/20 text-zinc-400")}>{l[t] ?? type?.charAt(0)}</span>
}
