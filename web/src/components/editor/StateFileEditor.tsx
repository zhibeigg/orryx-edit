import { useState, useMemo, useCallback, useRef } from "react"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface GlobalStateAnimation {
  "Start-Key"?: string
  "Loop-Key"?: string
  "End-Key"?: string
  "Start-Duration"?: string
  "Loop-Duration"?: string
  "End-Duration"?: string
}

interface GlobalStateEntry {
  Type: string
  Animation: GlobalStateAnimation
}

interface StateFileData {
  GlobalStates: Record<string, GlobalStateEntry>
}

interface StateFileEditorProps {
  content: string
  onChange: (yamlContent: string) => void
}

export function StateFileEditor({ content, onChange }: StateFileEditorProps) {
  const [activeTab, setActiveTab] = useState<"visual" | "yaml">("visual")
  const [selected, setSelected] = useState<string | null>(null)
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const data = useMemo<StateFileData>(() => {
    try {
      return parseYaml<StateFileData>(content)
    } catch {
      return { GlobalStates: {} }
    }
  }, [content])

  const updateData = useCallback((updater: (d: StateFileData) => StateFileData) => {
    const updated = updater(data)
    try {
      onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>))
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [data, onChange])

  const stateNames = Object.keys(data.GlobalStates ?? {})
  const selectedState = selected && data.GlobalStates?.[selected] ? data.GlobalStates[selected] : null

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        <button
          onClick={() => setActiveTab("visual")}
          className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
            activeTab === "visual" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          全局状态 ({stateNames.length})
        </button>
        <button
          onClick={() => setActiveTab("yaml")}
          className={cn("px-4 py-2 text-sm border-b-2 transition-colors",
            activeTab === "yaml" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          YAML 源码
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {activeTab === "visual" && (
          <>
            <div className="w-48 border-r border-border overflow-y-auto shrink-0 bg-muted/30">
              <div className="p-2 space-y-0.5">
                {stateNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => setSelected(name)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-sm",
                      selected === name ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    )}
                  >
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">{data.GlobalStates[name].Type}</div>
                  </button>
                ))}
                {stateNames.length === 0 && (
                  <div className="text-xs text-muted-foreground p-2">暂无全局状态</div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selectedState ? (
                <div className="p-4 space-y-4 max-w-2xl">
                  <h3 className="text-lg font-medium">{selected}</h3>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">状态类型 (Type)</label>
                      <input
                        className="input-base"
                        value={selectedState.Type ?? ""}
                        onChange={(e) => updateData((d) => ({
                          ...d,
                          GlobalStates: { ...d.GlobalStates, [selected!]: { ...selectedState, Type: e.target.value } },
                        }))}
                      />
                    </div>

                    <h4 className="text-sm font-semibold border-b border-border pb-1">动画 (Animation)</h4>

                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ["Start-Key", "开始动画"],
                        ["Loop-Key", "循环动画"],
                        ["End-Key", "结束动画"],
                        ["Start-Duration", "开始时长 (tick)"],
                        ["Loop-Duration", "循环时长 (tick)"],
                        ["End-Duration", "结束时长 (tick)"],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs text-muted-foreground">{label}</label>
                          <input
                            className="input-base"
                            value={(selectedState.Animation?.[key as keyof GlobalStateAnimation]) ?? ""}
                            onChange={(e) => updateData((d) => ({
                              ...d,
                              GlobalStates: {
                                ...d.GlobalStates,
                                [selected!]: {
                                  ...selectedState,
                                  Animation: { ...selectedState.Animation, [key]: e.target.value },
                                },
                              },
                            }))}
                          />
                        </div>
                      ))}
                    </div>

                    {/* 时间轴预览 */}
                    <h4 className="text-sm font-semibold border-b border-border pb-1">时间轴预览</h4>
                    <TimelinePreview animation={selectedState.Animation} />
                  </div>
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">从左侧选择一个全局状态进行编辑</div>
              )}
            </div>
          </>
        )}

        {activeTab === "yaml" && (
          <div className="flex-1">
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={content}
              onChange={(v) => onChange(v ?? "")}
              theme="vs-dark"
              options={{
                fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false },
                scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, insertSpaces: true,
                automaticLayout: true, padding: { top: 4 },
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TimelinePreview({ animation }: { animation?: GlobalStateAnimation }) {
  const startDur = parseInt(animation?.["Start-Duration"] ?? "0") || 0
  const loopDur = parseInt(animation?.["Loop-Duration"] ?? "0") || 0
  const endDur = parseInt(animation?.["End-Duration"] ?? "0") || 0
  const total = startDur + loopDur + endDur

  if (total === 0) return <div className="text-xs text-muted-foreground">未设置时长</div>

  const segments = [
    { label: "开始", dur: startDur, color: "bg-yellow-500/60" },
    { label: "循环", dur: loopDur, color: "bg-blue-500/60" },
    { label: "结束", dur: endDur, color: "bg-green-500/60" },
  ]

  return (
    <div className="space-y-1">
      <div className="flex h-8 rounded overflow-hidden border border-border">
        {segments.map((seg) => seg.dur > 0 && (
          <div
            key={seg.label}
            className={cn("flex items-center justify-center text-xs font-medium", seg.color)}
            style={{ width: `${(seg.dur / total) * 100}%` }}
          >
            {seg.label} ({seg.dur}t)
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">总时长: {total} tick ({(total / 20).toFixed(1)}s)</div>
    </div>
  )
}
