// Kether Scratch 风格积木编辑器
import { useState, useMemo, useCallback } from "react"
import { parseKether, type ASTNode } from "@/lib/kether-ast"
import type { ActionsSchema } from "@/lib/kether-ast"
import { getBlockColor, getBlockLabel, hasBody } from "./blocks/block-styles"
import { GripVertical, ChevronDown, ChevronRight, Trash2, Plus } from "lucide-react"

interface KetherBlockEditorProps {
  value: string
  onChange: (value: string) => void
  schema?: ActionsSchema
}

// ---- 单个积木块 ----
function Block({ node, depth = 0, onSelect, selectedId, onDelete }: {
  node: ASTNode
  depth?: number
  onSelect: (node: ASTNode) => void
  selectedId: string | null
  onDelete?: (node: ASTNode) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const color = getBlockColor(node)
  const label = getBlockLabel(node)
  const nodeId = `${node.start.offset}-${node.end.offset}`
  const isSelected = selectedId === nodeId
  const canCollapse = hasBody(node)

  const renderChildren = (children: ASTNode[]) => (
    <div className="ml-4 pl-2 border-l-2 space-y-1 mt-1" style={{ borderColor: color.border }}>
      {children.map((child, i) => (
        <Block key={`${child.start.offset}-${i}`} node={child} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} onDelete={onDelete} />
      ))}
      {children.length === 0 && (
        <div className="text-[11px] text-[#858585] italic py-1 px-2">空</div>
      )}
    </div>
  )

  const renderArgs = (args: ASTNode[]) => (
    <span className="inline-flex gap-1 ml-1">
      {args.map((arg, i) => (
        <InlineExpr key={i} node={arg} />
      ))}
    </span>
  )

  const renderKeywordArgs = (kw: Record<string, ASTNode>) => (
    <span className="inline-flex gap-1 ml-1">
      {Object.entries(kw).map(([key, val]) => (
        <span key={key} className="inline-flex items-center gap-0.5">
          <span className="text-[10px] opacity-70">{key}</span>
          <InlineExpr node={val} />
        </span>
      ))}
    </span>
  )

  return (
    <div className="group">
      <div
        className="flex items-start gap-1 rounded-sm cursor-pointer transition-all"
        style={{
          backgroundColor: isSelected ? color.bg : `${color.bg}cc`,
          borderLeft: `3px solid ${color.border}`,
          outline: isSelected ? `2px solid ${color.border}` : "none",
        }}
        onClick={(e) => { e.stopPropagation(); onSelect(node) }}
      >
        <div className="flex items-center gap-0.5 px-1.5 py-1 min-h-[28px] flex-wrap flex-1">
          <GripVertical className="w-3 h-3 opacity-40 shrink-0 cursor-grab" />
          {canCollapse && (
            <button onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }} className="p-0 shrink-0">
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
          <span className="text-[12px] font-mono font-medium" style={{ color: color.text }}>{label}</span>

          {/* 参数 */}
          {node.type === "action_call" && (
            <>
              {renderArgs(node.args)}
              {renderKeywordArgs(node.keywordArgs)}
            </>
          )}
          {node.type === "set" && <><span className="text-[11px] opacity-70 ml-1">to</span><InlineExpr node={node.value} /></>}
          {node.type === "check" && <><InlineExpr node={node.left} /><span className="text-[11px] opacity-70 mx-0.5">{node.operator}</span><InlineExpr node={node.right} /></>}
          {node.type === "math" && renderArgs(node.operands)}
          {node.type === "calc" && <span className="text-[11px] bg-black/20 px-1 rounded ml-1 font-mono">{node.formula}</span>}
          {node.type === "inline" && <span className="text-[11px] bg-black/20 px-1 rounded ml-1 font-mono">{node.template.length > 30 ? node.template.slice(0, 30) + "..." : node.template}</span>}
          {node.type === "lazy" && <InlineExpr node={node.expr} />}
          {node.type === "flag" && <><InlineExpr node={node.name} />{node.value && <><span className="text-[11px] opacity-70 mx-0.5">to</span><InlineExpr node={node.value} /></>}{node.timeout && <><span className="text-[11px] opacity-70 mx-0.5">timeout</span><InlineExpr node={node.timeout} /></>}</>}
          {node.type === "if" && <InlineExpr node={node.condition} />}
          {node.type === "for" && <><span className="text-[11px] opacity-70 mx-0.5">in</span><InlineExpr node={node.iterable} /></>}
          {node.type === "case" && <InlineExpr node={node.expr} />}
        </div>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(node) }}
            className="p-1 opacity-0 group-hover:opacity-60 hover:opacity-100 shrink-0"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        )}
      </div>

      {/* 子块 */}
      {!collapsed && node.type === "if" && (
        <>
          <div className="ml-2 mt-0.5">
            <div className="text-[10px] text-[#858585] uppercase tracking-wider mb-0.5">then</div>
            {renderChildren(node.thenBody)}
          </div>
          {node.elseIfClauses.map((clause, i) => (
            <div key={i} className="ml-2 mt-1">
              <div className="text-[10px] text-[#858585] uppercase tracking-wider mb-0.5">else if <InlineExpr node={clause.condition} /></div>
              {renderChildren(clause.body)}
            </div>
          ))}
          {node.elseBody && (
            <div className="ml-2 mt-1">
              <div className="text-[10px] text-[#858585] uppercase tracking-wider mb-0.5">else</div>
              {renderChildren(node.elseBody)}
            </div>
          )}
        </>
      )}
      {!collapsed && node.type === "for" && renderChildren(node.body)}
      {!collapsed && node.type === "block" && renderChildren(node.body)}
      {!collapsed && node.type === "case" && (
        <div className="ml-2 mt-0.5 space-y-1">
          {node.whenClauses.map((w, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-[10px] text-[#858585] shrink-0 mt-1">when</span>
              <InlineExpr node={w.value} />
              <span className="text-[10px] text-[#858585] shrink-0 mt-1">→</span>
              <div className="flex-1"><Block node={w.body} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} /></div>
            </div>
          ))}
          {node.elseClause && (
            <div className="flex items-start gap-1">
              <span className="text-[10px] text-[#858585] shrink-0 mt-1">else</span>
              <div className="flex-1"><Block node={node.elseClause} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} /></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- 内联表达式（参数值） ----
function InlineExpr({ node }: { node: ASTNode }) {
  const color = getBlockColor(node)
  const label = getBlockLabel(node)

  if (node.type === "action_call" || node.type === "if" || node.type === "for" || node.type === "block") {
    return (
      <span className="inline-flex items-center px-1 py-0 rounded-sm text-[11px] font-mono" style={{ backgroundColor: `${color.bg}88`, color: color.text }}>
        {label}...
      </span>
    )
  }

  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded-sm text-[11px] font-mono" style={{ backgroundColor: `${color.bg}88`, color: color.text }}>
      {label}
    </span>
  )
}

// ---- 积木面板（左侧拖拽源） ----
function BlockPalette({ schema, onInsert }: { schema?: ActionsSchema; onInsert: (template: string) => void }) {
  const [search, setSearch] = useState("")
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  const categories = useMemo(() => {
    const cats = new Map<string, { name: string; items: { label: string; template: string; detail?: string }[] }>()

    // 控制流
    cats.set("control", { name: "控制流", items: [
      { label: "if ... then", template: 'if check true then {\n  \n}', detail: "条件分支" },
      { label: "for ... in", template: 'for i in range 1 to 10 then {\n  \n}', detail: "循环" },
      { label: "case ... when", template: 'case &var [\n  when "a" -> \n  else \n]', detail: "模式匹配" },
      { label: "sync { }", template: 'sync {\n  \n}', detail: "同步块" },
      { label: "async { }", template: 'async {\n  \n}', detail: "异步块" },
    ]})

    // 变量
    cats.set("variable", { name: "变量", items: [
      { label: "set ... to", template: "set a to 0", detail: "设置变量" },
      { label: "flag ... to", template: "flag 名称 to true", detail: "设置 Flag" },
      { label: "flag ... remove", template: "flag 名称 remove", detail: "移除 Flag" },
    ]})

    // 数学
    cats.set("math", { name: "数学", items: [
      { label: "math add", template: "math add [ 1 2 ]", detail: "加法" },
      { label: "math sub", template: "math sub [ 10 5 ]", detail: "减法" },
      { label: "math mul", template: "math mul [ 2 3 ]", detail: "乘法" },
      { label: "math div", template: "math div [ 10 2 ]", detail: "除法" },
      { label: "calc", template: 'calc "100+level*10"', detail: "公式计算" },
    ]})

    // Actions（从 schema 分组）
    if (schema) {
      const actionCats = new Map<string, { label: string; template: string; detail?: string }[]>()
      for (const action of schema.actions) {
        const cat = action.category ?? "misc"
        if (!actionCats.has(cat)) actionCats.set(cat, [])
        actionCats.get(cat)!.push({
          label: action.name,
          template: action.name,
          detail: (action.params ?? []).slice(0, 3).map(p => p.name).join(", "),
        })
      }
      for (const [cat, items] of actionCats) {
        cats.set(`action_${cat}`, { name: cat, items })
      }
    }

    return cats
  }, [schema])

  const filtered = useMemo(() => {
    if (!search) return categories
    const result = new Map<string, { name: string; items: { label: string; template: string; detail?: string }[] }>()
    for (const [key, cat] of categories) {
      const items = cat.items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
      if (items.length > 0) result.set(key, { ...cat, items })
    }
    return result
  }, [categories, search])

  return (
    <div className="w-48 border-r border-[#3c3c3c] flex flex-col bg-[#252526] shrink-0">
      <div className="p-1.5 border-b border-[#3c3c3c]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索积木..."
          className="w-full px-2 py-1 text-[11px] bg-[#3c3c3c] border-none text-[#cccccc] focus:outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {[...filtered].map(([key, cat]) => (
          <div key={key}>
            <button
              onClick={() => setExpandedCat(expandedCat === key ? null : key)}
              className="w-full px-2 py-1 text-[11px] font-semibold text-[#858585] uppercase tracking-wider hover:bg-[#2a2d2e] flex items-center gap-1"
            >
              {expandedCat === key ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {cat.name}
              <span className="text-[9px] opacity-50 ml-auto">{cat.items.length}</span>
            </button>
            {expandedCat === key && cat.items.map((item, i) => (
              <button
                key={i}
                onClick={() => onInsert(item.template)}
                className="w-full px-3 py-1 text-[11px] text-left hover:bg-[#2a2d2e] text-[#cccccc] flex items-center gap-1"
              >
                <Plus className="w-2.5 h-2.5 text-[#858585]" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- 主编辑器 ----
export function KetherBlockEditor({ value, onChange, schema }: KetherBlockEditorProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const ast = useMemo(() => {
    try {
      const result = parseKether(value, schema)
      setParseError(null)
      return result
    } catch (e) {
      setParseError(String(e))
      return null
    }
  }, [value, schema])

  const handleSelect = useCallback((node: ASTNode) => {
    setSelectedNode(`${node.start.offset}-${node.end.offset}`)
  }, [])

  const handleDelete = useCallback((node: ASTNode) => {
    // 从源码中删除该节点对应的文本
    const before = value.slice(0, node.start.offset)
    const after = value.slice(node.end.offset)
    // 清理多余的空行
    const cleaned = (before.trimEnd() + "\n" + after.trimStart()).replace(/\n{3,}/g, "\n\n")
    onChange(cleaned)
  }, [value, onChange])

  const handleInsert = useCallback((template: string) => {
    onChange(value.trimEnd() + "\n" + template)
  }, [value, onChange])

  return (
    <div className="flex h-full">
      <BlockPalette schema={schema} onInsert={handleInsert} />
      <div className="flex-1 overflow-auto p-3 space-y-1 bg-[#1e1e1e]">
        {parseError && (
          <div className="text-[11px] text-red-400 bg-red-400/10 px-2 py-1 mb-2">
            解析错误: {parseError}
          </div>
        )}
        {ast && ast.body.length === 0 && (
          <div className="text-[13px] text-[#858585] text-center py-8">
            从左侧面板拖拽积木块开始编辑
          </div>
        )}
        {ast?.body.map((node, i) => (
          <Block
            key={`${node.start.offset}-${i}`}
            node={node}
            onSelect={handleSelect}
            selectedId={selectedNode}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}
