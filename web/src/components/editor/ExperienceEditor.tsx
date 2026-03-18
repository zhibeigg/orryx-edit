import { useState, useMemo, useCallback, useRef } from "react"
import type { ExperienceData, ExperienceOptions } from "@/types"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { evaluateKether, formatKetherScript } from "@/lib/kether-eval"
import { ActionsEditor } from "./ActionsEditor"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface ExperienceEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

type Tab = "editor" | "curve" | "yaml"

export function ExperienceEditor({ content, onChange }: ExperienceEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("editor")
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const data = useMemo<ExperienceData>(() => {
    try {
      return parseYaml<ExperienceData>(content)
    } catch {
      return { Options: { Min: 0, Max: 20, ExperienceOfLevel: 'calc "200*level"' } }
    }
  }, [content])

  const updateOptions = useCallback((patch: Partial<ExperienceOptions>) => {
    const updated = { ...data, Options: { ...data.Options, ...patch } }
    try {
      onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>))
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [data, onChange])

  // 格式化经验公式（仅首次挂载时，避免反复格式化导致 dirty）
  const [formulaValue, setFormulaValue] = useState(() =>
    formatKetherScript(data.Options?.ExperienceOfLevel ?? "")
  )

  const updateFormula = useCallback((v: string) => {
    setFormulaValue(v)
    updateOptions({ ExperienceOfLevel: v })
  }, [updateOptions])

  const tabs: { id: Tab; label: string }[] = [
    { id: "editor", label: "经验配置" },
    { id: "curve", label: "经验曲线" },
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

      <div className="flex-1 overflow-y-auto">
        {activeTab === "editor" && (
          <ConfigPanel options={data.Options} onChange={updateOptions} formulaValue={formulaValue} onFormulaChange={updateFormula} />
        )}

        {activeTab === "curve" && (
          <CurvePreview options={{ ...data.Options, ExperienceOfLevel: formulaValue }} />
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
  )
}

// ---- 配置面板 ----
function ConfigPanel({ options, onChange, formulaValue, onFormulaChange }: {
  options: ExperienceOptions
  onChange: (p: Partial<ExperienceOptions>) => void
  formulaValue: string
  onFormulaChange: (v: string) => void
}) {
  return (
    <div className="p-4 space-y-6 max-w-4xl">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">等级范围</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">最小等级 (Min)</label>
            <input
              type="number"
              value={options.Min ?? 0}
              onChange={(e) => onChange({ Min: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">最大等级 (Max)</label>
            <input
              type="number"
              value={options.Max ?? 20}
              onChange={(e) => onChange({ Max: parseInt(e.target.value) || 20 })}
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md"
            />
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          等级范围: {options.Min ?? 0} ~ {options.Max ?? 20}，共 {(options.Max ?? 20) - (options.Min ?? 0)} 级
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">
          经验公式 (ExperienceOfLevel)
        </h3>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Kether 脚本，传入 <code className="text-blue-400">level</code> 变量（当前等级），返回该等级升级所需经验值。</p>
          <p>可用变量: <code className="text-blue-400">&level</code> — 当前等级</p>
        </div>
        <ActionsEditor
          value={formulaValue}
          onChange={onFormulaChange}
          height="250px"
        />
      </div>
    </div>
  )
}

// ---- 经验曲线预览 ----
function CurvePreview({ options }: { options: ExperienceOptions }) {
  const min = options.Min ?? 0
  const max = options.Max ?? 20
  const formula = options.ExperienceOfLevel ?? ""

  // 尝试用简单的 calc 表达式计算经验值
  const curveData = useMemo(() => {
    const points: { level: number; exp: number }[] = []

    for (let level = min; level <= max; level++) {
      const exp = evaluateKether(formula, { level })
      points.push({ level, exp: Math.max(0, Math.round(exp)) })
    }

    return points
  }, [min, max, formula])

  const maxExp = Math.max(...curveData.map(p => p.exp), 1)
  const totalExp = curveData.reduce((sum, p) => sum + p.exp, 0)
  const hasValidData = curveData.some(p => p.exp > 0)

  return (
    <div className="p-4 space-y-4">
      {/* 统计信息 */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="等级范围" value={`${min} ~ ${max}`} />
        <StatCard label="总经验需求" value={formatNumber(totalExp)} />
        <StatCard label="最低经验" value={formatNumber(Math.min(...curveData.map(p => p.exp)))} />
        <StatCard label="最高经验" value={formatNumber(maxExp)} />
      </div>

      {!hasValidData && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-4">
          无法预览经验曲线：公式可能包含不支持的 Kether 语法。
          <br />
          <span className="text-xs">
            支持: <code>calc "表达式"</code>、<code>set 变量 to 表达式</code>、<code>pow</code>、<code>math add/sub/mul/div</code>、<code>case/when</code> 分支
          </span>
        </div>
      )}

      {hasValidData && (
        <>
          {/* 柱状图 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">经验曲线</h3>
            <div className="bg-muted/30 rounded-md p-4 border border-border">
              <div className="flex items-end gap-[2px] h-48">
                {curveData.map((point) => {
                  const height = maxExp > 0 ? (point.exp / maxExp) * 100 : 0
                  return (
                    <div
                      key={point.level}
                      className="flex-1 flex flex-col items-center justify-end group relative h-full"
                    >
                      <div
                        className="w-full bg-[#007acc] hover:bg-[#0098ff] rounded-t-sm transition-colors min-h-[2px]"
                        style={{ height: `${height}%` }}
                      />
                      {/* 悬浮提示 */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-10 border border-border">
                        Lv.{point.level}: {formatNumber(point.exp)} exp
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* X 轴标签 */}
              <div className="flex gap-[2px] mt-1">
                {curveData.map((point, i) => (
                  <div key={point.level} className="flex-1 text-center text-[9px] text-muted-foreground">
                    {curveData.length <= 30 || i % Math.ceil(curveData.length / 15) === 0 ? point.level : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 经验表 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">经验表</h3>
            <div className="border border-border rounded-md overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs text-muted-foreground font-medium">等级</th>
                    <th className="px-3 py-1.5 text-right text-xs text-muted-foreground font-medium">升级经验</th>
                    <th className="px-3 py-1.5 text-right text-xs text-muted-foreground font-medium">累计经验</th>
                    <th className="px-3 py-1.5 text-left text-xs text-muted-foreground font-medium w-1/3">进度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {curveData.map((point, i) => {
                    const cumulative = curveData.slice(0, i + 1).reduce((s, p) => s + p.exp, 0)
                    const pct = maxExp > 0 ? (point.exp / maxExp) * 100 : 0
                    return (
                      <tr key={point.level} className="hover:bg-muted/20">
                        <td className="px-3 py-1 font-mono">{point.level}</td>
                        <td className="px-3 py-1 text-right font-mono">{formatNumber(point.exp)}</td>
                        <td className="px-3 py-1 text-right font-mono text-muted-foreground">{formatNumber(cumulative)}</td>
                        <td className="px-3 py-1">
                          <div className="h-2 bg-muted rounded-sm overflow-hidden">
                            <div className="h-full bg-[#007acc] rounded-sm" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 border border-border rounded-md px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-medium text-foreground">{value}</div>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return Math.round(n).toString()
}
