import { useState, useMemo } from "react"
import { Plus, Trash2, GripVertical, Eye } from "lucide-react"
import { evaluateKether } from "@/lib/kether-eval"
import { Slider } from "@/components/ui/slider"

interface DescriptionEditorProps {
  descriptions: string[]
  variables: Record<string, number | string>
  minLevel: number
  maxLevel: number
  onChange: (descriptions: string[]) => void
}

// Minecraft 颜色代码映射
const MC_COLORS: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
  "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF",
  c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
}

// Minecraft 格式代码
const MC_FORMATS: Record<string, string> = {
  l: "font-weight:bold",
  o: "font-style:italic",
  n: "text-decoration:underline",
  m: "text-decoration:line-through",
  r: "", // reset
}

/** 将 Minecraft 颜色代码字符串渲染为 HTML spans */
function renderMinecraftText(text: string): { __html: string } {
  let html = ""
  let currentColor = "#FFFFFF"
  let currentFormats: string[] = []
  let i = 0

  while (i < text.length) {
    if (text[i] === "&" && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase()
      if (MC_COLORS[code]) {
        currentColor = MC_COLORS[code]
        i += 2
        continue
      }
      if (MC_FORMATS[code] !== undefined) {
        if (code === "r") {
          currentColor = "#FFFFFF"
          currentFormats = []
        } else {
          currentFormats.push(MC_FORMATS[code])
        }
        i += 2
        continue
      }
    }
    // 转义 HTML
    const ch = text[i] === "<" ? "&lt;" : text[i] === ">" ? "&gt;" : text[i] === "&" ? "&amp;" : text[i]
    const style = `color:${currentColor}${currentFormats.length ? ";" + currentFormats.join(";") : ""}`
    html += `<span style="${style}">${ch}</span>`
    i++
  }

  return { __html: html }
}

/** 求值描述行中的 {{ kether表达式 }} 模板 */
function evaluateDescriptionLine(
  line: string,
  variables: Record<string, number | string>,
  level: number
): string {
  return line.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    const trimmed = expr.trim()
    try {
      // 处理 scaled 关键字：scaled <expr> 表示 expr * level
      let isScaled = false
      let innerExpr = trimmed
      if (innerExpr.startsWith("scaled ")) {
        isScaled = true
        innerExpr = innerExpr.substring(7).trim()
      }

      // 处理 lazy *变量名 → 直接替换为变量值
      innerExpr = innerExpr.replace(/lazy\s+\*(\w+)/g, (_, varName: string) => {
        const key = varName.charAt(0).toUpperCase() + varName.slice(1)
        const val = variables[key] ?? variables[varName] ?? 0
        return String(Number(val) || 0)
      })

      // 替换 &level
      innerExpr = innerExpr.replace(/&level/g, String(level))

      // 尝试用 kether-eval 求值
      const result = evaluateKether(innerExpr, { level })
      if (result !== null && !isNaN(result)) {
        const finalVal = isScaled ? result * level : result
        // 格式化：整数不带小数点，小数保留1位
        return Number.isInteger(finalVal) ? String(finalVal) : finalVal.toFixed(1)
      }

      // fallback：简单数学表达式
      const simpleResult = evaluateSimpleExpr(innerExpr)
      if (simpleResult !== null) {
        const finalVal = isScaled ? simpleResult * level : simpleResult
        return Number.isInteger(finalVal) ? String(finalVal) : finalVal.toFixed(1)
      }

      return `{{${trimmed}}}`
    } catch {
      return `{{${trimmed}}}`
    }
  })
}

function evaluateSimpleExpr(expr: string): number | null {
  // math div [ A B ] → A / B
  const divMatch = expr.match(/math\s+div\s+\[\s*([\d.]+)\s+([\d.]+)\s*\]/)
  if (divMatch) return parseFloat(divMatch[1]) / parseFloat(divMatch[2])

  const mulMatch = expr.match(/math\s+mul\s+\[\s*([\d.]+)\s+([\d.]+)\s*\]/)
  if (mulMatch) return parseFloat(mulMatch[1]) * parseFloat(mulMatch[2])

  const addMatch = expr.match(/math\s+add\s+\[\s*([\d.]+)\s+([\d.]+)\s*\]/)
  if (addMatch) return parseFloat(addMatch[1]) + parseFloat(addMatch[2])

  // 纯数字
  const num = parseFloat(expr)
  if (!isNaN(num)) return num

  return null
}

export function DescriptionEditor({ descriptions, variables, minLevel, maxLevel, onChange }: DescriptionEditorProps) {
  const [previewLevel, setPreviewLevel] = useState(minLevel)
  const [showPreview, setShowPreview] = useState(true)

  const updateLine = (index: number, value: string) => {
    const newDescs = [...descriptions]
    newDescs[index] = value
    onChange(newDescs)
  }

  const addLine = () => {
    onChange([...descriptions, ""])
  }

  const removeLine = (index: number) => {
    onChange(descriptions.filter((_, i) => i !== index))
  }

  const moveLine = (from: number, to: number) => {
    if (to < 0 || to >= descriptions.length) return
    const newDescs = [...descriptions]
    const [item] = newDescs.splice(from, 1)
    newDescs.splice(to, 0, item)
    onChange(newDescs)
  }

  // 预览渲染
  const previewLines = useMemo(() => {
    return descriptions
      .filter(line => !line.startsWith("*")) // *开头不预览
      .map(line => evaluateDescriptionLine(line, variables, previewLevel))
  }, [descriptions, variables, previewLevel])

  return (
    <div className="flex flex-col h-full">
      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#cccccc]">描述 (Description)</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 ${showPreview ? "text-[#007acc]" : "text-[#858585]"} hover:text-[#cccccc]`}
            >
              <Eye className="w-3 h-3" /> 预览
            </button>
            <button onClick={addLine} className="flex items-center gap-1 text-[11px] text-[#858585] hover:text-[#cccccc]">
              <Plus className="w-3 h-3" /> 添加行
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {descriptions.map((line, index) => (
            <div key={index} className="flex items-center gap-1 group">
              <button
                onClick={() => moveLine(index, index - 1)}
                className="text-[#858585] hover:text-[#cccccc] opacity-0 group-hover:opacity-100 p-0.5"
                disabled={index === 0}
              >
                <GripVertical className="w-3 h-3" />
              </button>
              <span className="text-[11px] text-[#858585] w-4 text-right shrink-0">{index}</span>
              <input
                value={line}
                onChange={(e) => updateLine(index, e.target.value)}
                className="flex-1 px-2 py-1 text-[13px] bg-[#3c3c3c] border border-[#3c3c3c] text-[#cccccc] focus:outline-none focus:border-[#007acc] font-mono"
                placeholder="描述行..."
              />
              {line.includes("{{") && (
                <span className="text-[10px] text-[#dcdcaa] shrink-0 px-1">模板</span>
              )}
              {line.startsWith("*") && (
                <span className="text-[10px] text-[#569cd6] shrink-0 px-1">隐藏</span>
              )}
              <button onClick={() => removeLine(index)} className="text-[#858585] hover:text-[#f44747] p-0.5 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {descriptions.length === 0 && (
            <p className="text-[13px] text-[#858585]">暂无描述</p>
          )}
        </div>
      </div>

      {/* 游戏内预览 */}
      {showPreview && descriptions.length > 0 && (
        <div className="border-t border-[#3c3c3c] shrink-0">
          {/* 等级滑块 */}
          <div className="flex items-center gap-3 px-4 py-2 bg-[#252526]">
            <span className="text-[11px] text-[#858585]">预览等级</span>
            <Slider
              min={minLevel}
              max={maxLevel}
              value={[previewLevel]}
              onValueChange={(v) => setPreviewLevel(v[0])}
              className="flex-1"
            />
            <span className="text-[13px] text-[#007acc] font-mono w-8 text-center">{previewLevel}</span>
          </div>

          {/* Minecraft 风格预览框 */}
          <div className="mx-4 mb-4 mt-1">
            <div
              className="p-3 rounded-sm border border-[#2a0a3a]"
              style={{
                background: "linear-gradient(180deg, #100010 0%, #1a0028 100%)",
                boxShadow: "inset 0 0 8px rgba(80, 0, 120, 0.3)",
              }}
            >
              {previewLines.map((line, i) => (
                <div
                  key={i}
                  className="leading-6 font-mono text-[14px]"
                  style={{ textShadow: "1px 1px 0px #3f3f3f" }}
                  dangerouslySetInnerHTML={renderMinecraftText(line)}
                />
              ))}
            </div>
            <p className="text-[10px] text-[#858585] mt-1">
              游戏内预览 (Lv.{previewLevel}) · <code className="text-[#dcdcaa]">&amp;颜色代码</code> 已渲染 · <code className="text-[#dcdcaa]">{"{{ }}"}</code> 已求值
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
