import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { ActionsEditor } from "./ActionsEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface StatusOptions {
  Condition?: string
  CancelHeldEventWhenPlaying?: boolean
  Controller?: string
  CancelBukkitAttack?: boolean
  AttackSpeed?: string
}

interface StateAnimation {
  Key?: string
  Front?: string
  Rear?: string
  Left?: string
  Right?: string
  Duration?: string
  SuccessKey?: string
}

interface StateEntry {
  Type: string
  Connection?: string
  Check?: string
  Invincible?: string
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

interface StatusEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

type Tab = "overview" | "states" | "dispatch" | "refs" | "yaml"

export function StatusEditor({ content, onChange, filePath }: StatusEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const data = useMemo<StatusData>(() => {
    try {
      return parseYaml<StatusData>(content)
    } catch {
      return { Options: {}, States: {}, Action: "" }
    }
  }, [content])

  const updateData = useCallback((updater: (d: StatusData) => StatusData) => {
    const updated = updater(data)
    try {
      onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>))
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [data, onChange])

  const stateNames = Object.keys(data.States ?? {})

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "总览" },
    { id: "states", label: `状态 (${stateNames.length})` },
    { id: "dispatch", label: "输入分发" },
    { id: "refs", label: "引用" },
    { id: "yaml", label: "YAML 源码" },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
              activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {activeTab === "states" && (
          <div className="w-48 border-r border-border overflow-y-auto shrink-0 bg-muted/30">
            <div className="p-2 space-y-0.5">
              {stateNames.map((name) => {
                const state = data.States[name]
                return (
                  <button key={name} onClick={() => setSelectedState(name)}
                    className={cn("w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2",
                      selectedState === name ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")}>
                    <TypeBadge type={state.Type} />
                    <span className="truncate">{name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {activeTab === "overview" && (
            <div className="p-4 space-y-4 max-w-3xl">
              <Section title="全局配置">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="控制器"><input className="input-base" value={data.Options.Controller ?? ""} onChange={(e) => updateData((d) => ({ ...d, Options: { ...d.Options, Controller: e.target.value } }))} /></Field>
                  <Field label="条件 (Kether)"><input className="input-base" value={data.Options.Condition ?? ""} onChange={(e) => updateData((d) => ({ ...d, Options: { ...d.Options, Condition: e.target.value } }))} /></Field>
                </div>
                <div className="flex gap-4">
                  <Toggle label="禁止滚轮切换" checked={data.Options.CancelHeldEventWhenPlaying ?? false} onChange={(v) => updateData((d) => ({ ...d, Options: { ...d.Options, CancelHeldEventWhenPlaying: v } }))} />
                  <Toggle label="取消原版攻击" checked={data.Options.CancelBukkitAttack ?? false} onChange={(v) => updateData((d) => ({ ...d, Options: { ...d.Options, CancelBukkitAttack: v } }))} />
                </div>
                <Field label="攻速公式 (Kether)">
                  <textarea className="input-base h-16 font-mono text-xs" value={data.Options.AttackSpeed ?? ""} onChange={(e) => updateData((d) => ({ ...d, Options: { ...d.Options, AttackSpeed: e.target.value } }))} />
                </Field>
              </Section>

              <Section title="状态流程图">
                {["General Attack", "Block", "Dodge"].map((type) => {
                  const filtered = stateNames.filter((n) => data.States[n]?.Type === type)
                  if (filtered.length === 0) return null
                  return (
                    <div key={type}>
                      <div className="text-xs text-muted-foreground mb-1">{typeLabel(type)}</div>
                      <div className="flex flex-wrap gap-2">
                        {filtered.map((name) => {
                          const s = data.States[name]
                          return (
                            <div key={name} className="border border-border rounded px-3 py-2 bg-muted/30 text-sm space-y-1 min-w-[160px]">
                              <div className="flex items-center gap-2"><TypeBadge type={type} /><span className="font-medium">{name}</span></div>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                {s.Animation?.Duration && <div>时长: {s.Animation.Duration}t</div>}
                                {s.Connection && <div>衔接: {s.Connection}t</div>}
                                {s.Invincible && <div>无敌: {s.Invincible}t</div>}
                                {s.Spirit !== undefined && <div>精力: {s.Spirit}</div>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </Section>
            </div>
          )}

          {activeTab === "states" && selectedState && data.States[selectedState] && (() => {
            const state = data.States[selectedState]
            const update = (patch: Partial<StateEntry>) => updateData((d) => ({ ...d, States: { ...d.States, [selectedState]: { ...state, ...patch } } }))
            const updateAnim = (patch: Partial<StateAnimation>) => update({ Animation: { ...state.Animation, ...patch } })
            const isDodge = state.Type === "Dodge"
            const isBlock = state.Type === "Block"

            return (
              <div className="p-4 space-y-4 max-w-3xl">
                <div className="flex items-center gap-3"><TypeBadge type={state.Type} /><h3 className="text-lg font-medium">{selectedState}</h3></div>

                <Section title="基础属性">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="类型">
                      <select className="input-base" value={state.Type} onChange={(e) => update({ Type: e.target.value })}>
                        <option value="General Attack">General Attack (普攻)</option>
                        <option value="Block">Block (格挡)</option>
                        <option value="Dodge">Dodge (闪避)</option>
                      </select>
                    </Field>
                    <Field label="衔接窗口 (tick)"><input className="input-base" value={state.Connection ?? ""} onChange={(e) => update({ Connection: e.target.value })} placeholder="8-16" /></Field>
                    {(isBlock || isDodge) && <Field label="无敌帧 (tick)"><input className="input-base" value={state.Invincible ?? ""} onChange={(e) => update({ Invincible: e.target.value })} /></Field>}
                    {isBlock && <Field label="格挡检测 (tick)"><input className="input-base" value={state.Check ?? ""} onChange={(e) => update({ Check: e.target.value })} /></Field>}
                    {isBlock && <Field label="伤害类型"><input className="input-base" value={state.DamageType ?? ""} onChange={(e) => update({ DamageType: e.target.value })} /></Field>}
                    {isDodge && <Field label="精力消耗"><input className="input-base" type="number" value={state.Spirit ?? 0} onChange={(e) => update({ Spirit: parseInt(e.target.value) || 0 })} /></Field>}
                  </div>
                </Section>

                <Section title="动画">
                  <div className="grid grid-cols-2 gap-3">
                    {isDodge ? (
                      <>
                        <Field label="前"><input className="input-base" value={state.Animation?.Front ?? ""} onChange={(e) => updateAnim({ Front: e.target.value })} /></Field>
                        <Field label="后"><input className="input-base" value={state.Animation?.Rear ?? ""} onChange={(e) => updateAnim({ Rear: e.target.value })} /></Field>
                        <Field label="左"><input className="input-base" value={state.Animation?.Left ?? ""} onChange={(e) => updateAnim({ Left: e.target.value })} /></Field>
                        <Field label="右"><input className="input-base" value={state.Animation?.Right ?? ""} onChange={(e) => updateAnim({ Right: e.target.value })} /></Field>
                      </>
                    ) : (
                      <Field label="动画名"><input className="input-base" value={state.Animation?.Key ?? ""} onChange={(e) => updateAnim({ Key: e.target.value })} /></Field>
                    )}
                    <Field label="时长 (tick)"><input className="input-base" value={state.Animation?.Duration ?? ""} onChange={(e) => updateAnim({ Duration: e.target.value })} /></Field>
                    {isBlock && <Field label="成功动画"><input className="input-base" value={state.Animation?.SuccessKey ?? ""} onChange={(e) => updateAnim({ SuccessKey: e.target.value })} /></Field>}
                  </div>
                </Section>

                <Section title="Action 脚本">
                  <ActionsEditor value={state.Action ?? ""} onChange={(v) => update({ Action: v })} height="200px" />
                </Section>

                {isBlock && (
                  <Section title="格挡成功脚本">
                    <ActionsEditor value={state.BlockAction ?? ""} onChange={(v) => update({ BlockAction: v })} height="150px" />
                  </Section>
                )}
              </div>
            )
          })()}

          {activeTab === "states" && !selectedState && <div className="p-4 text-sm text-muted-foreground">从左侧选择一个状态</div>}

          {activeTab === "dispatch" && (
            <div className="h-full flex flex-col">
              <div className="px-4 pt-3 pb-1 text-xs text-muted-foreground">输入分发脚本 — 根据按键决定进入哪个状态</div>
              <div className="flex-1"><ActionsEditor value={data.Action ?? ""} onChange={(v) => updateData((d) => ({ ...d, Action: v }))} height="100%" /></div>
            </div>
          )}

          {activeTab === "refs" && filePath && <CrossRefPanel currentFile={filePath} />}
          {activeTab === "refs" && !filePath && <div className="p-4 text-sm text-muted-foreground">无法分析引用。</div>}

          {activeTab === "yaml" && (
            <div className="h-full">
              <Editor height="100%" defaultLanguage="yaml" value={content} onChange={(v) => onChange(v ?? "")} theme="vs-dark"
                options={{ fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 } }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-3"><h3 className="text-sm font-semibold border-b border-border pb-1">{title}</h3>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" /><span>{label}</span></label>
}
function TypeBadge({ type }: { type: string }) {
  const c: Record<string, string> = { "General Attack": "bg-red-500/20 text-red-400", "Block": "bg-blue-500/20 text-blue-400", "Dodge": "bg-green-500/20 text-green-400" }
  const l: Record<string, string> = { "General Attack": "攻", "Block": "挡", "Dodge": "闪" }
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", c[type] ?? "bg-zinc-500/20 text-zinc-400")}>{l[type] ?? type.charAt(0)}</span>
}
function typeLabel(type: string): string {
  return ({ "General Attack": "普通攻击", "Block": "格挡", "Dodge": "闪避" } as Record<string, string>)[type] ?? type
}
