import { useState, useMemo, useCallback } from "react"
import { ChevronDown, ChevronRight, Search, GripVertical, MoveRight, PanelLeftOpen } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"

interface NodePaletteProps {
  schema: ActionsSchemaV2
  onDragStart: (action: SchemaAction | { builtin: string }) => void
}

const BUILTIN_NODES = [
  { builtin: "set", label: "set 变量", description: "设置变量值" },
  { builtin: "if", label: "if 条件", description: "C 形条件分支" },
  { builtin: "for", label: "for 循环", description: "C 形遍历循环" },
  { builtin: "case", label: "case 分派", description: "多分支容器" },
  { builtin: "check", label: "check 判断", description: "布尔谓词" },
  { builtin: "any", label: "any 任一", description: "条件列表" },
  { builtin: "all", label: "all 全部", description: "条件列表" },
  { builtin: "math", label: "math 运算", description: "数值 reporter" },
  { builtin: "calc", label: "calc 公式", description: "表达式计算" },
  { builtin: "sync", label: "sync 块", description: "同步匿名块" },
  { builtin: "async", label: "async 块", description: "异步匿名块" },
  { builtin: "raw", label: "Raw Kether", description: "只保留无法结构化的局部原文" },
]

export function NodePalette({ schema, onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("")
  const [expandedCat, setExpandedCat] = useState<string | null>("$builtin")
  const [collapsed, setCollapsed] = useState(false)

  const categories = useMemo(() => {
    const cats = new Map<string, SchemaAction[]>()
    for (const action of schema.actions) {
      const cat = action.category
      if (!cats.has(cat)) cats.set(cat, [])
      cats.get(cat)!.push(action)
    }
    return cats
  }, [schema])

  const filtered = useMemo(() => {
    if (!search) return categories
    const q = search.toLowerCase()
    const result = new Map<string, SchemaAction[]>()
    for (const [cat, actions] of categories) {
      const matched = actions.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.aliases ?? []).some(al => al.toLowerCase().includes(q)) ||
        a.description.toLowerCase().includes(q)
      )
      if (matched.length > 0) result.set(cat, matched)
    }
    return result
  }, [categories, search])

  const handleDragStart = useCallback((e: React.DragEvent, action: SchemaAction | { builtin: string }) => {
    e.dataTransfer.setData("application/kether-node", JSON.stringify(action))
    e.dataTransfer.effectAllowed = "move"
    onDragStart(action)
  }, [onDragStart])

  return (
    <div className="kether-palette flex flex-col shrink-0 select-none" data-collapsed={collapsed}>
      <div className="p-2 border-b border-[oklch(0.38_0.055_34)] bg-[oklch(0.17_0.018_32)]">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.16em] text-[oklch(0.72_0.025_62)]">
          <span>节点库</span>
          <button type="button" onClick={() => setCollapsed((value) => !value)} className="hidden max-md:inline-flex items-center gap-1 border border-[oklch(0.38_0.055_34)] px-1.5 py-1 text-[9px]" aria-expanded={!collapsed}>
            <PanelLeftOpen className="h-3 w-3" />{collapsed ? "展开" : "收起"}
          </button>
        </div>
        <div className="kether-palette__body flex items-center gap-1.5 px-2 py-1.5 bg-[oklch(0.21_0.025_30)] border border-[oklch(0.38_0.055_34)] focus-within:border-[oklch(0.72_0.17_48)]">
          <Search className="w-3 h-3 text-[#7f8a9b]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索 action / alias..." className="flex-1 text-[11px] bg-transparent border-none text-[#c6cedb] focus:outline-none placeholder:text-[#677488]" />
        </div>
        <div className="kether-palette__body mt-2 flex items-center gap-1 text-[10px] text-[oklch(0.72_0.025_62)]">
          <MoveRight className="w-3 h-3" />
          拖拽到右侧画布即可创建节点
        </div>
      </div>

      <div className="kether-palette__body flex-1 overflow-y-auto max-md:overflow-x-auto">
        <div>
          <button onClick={() => setExpandedCat(expandedCat === "$builtin" ? null : "$builtin")}
            className="w-full px-2.5 py-2 text-[10px] font-semibold text-[#8b97ab] uppercase tracking-[0.16em] hover:bg-[#1d222b] flex items-center gap-1.5 transition-colors">
            {expandedCat === "$builtin" ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            控制流
          </button>
          {expandedCat === "$builtin" && BUILTIN_NODES.map(node => (
            <div key={node.builtin} draggable
              onDragStart={e => handleDragStart(e, node)}
              className="kether-palette__item group mx-1 flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-[oklch(0.91_0.025_78)] cursor-grab">
              <GripVertical className="w-3 h-3 text-[#6f7b8f] group-hover:text-[#94b8e4]" />
              <span className="truncate">{node.label}</span>
              <span className="text-[9px] text-[#6f7b8f] ml-auto truncate max-w-[70px]">{node.description}</span>
            </div>
          ))}
        </div>

        {[...filtered].map(([cat, actions]) => (
          <div key={cat}>
            <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
              className="w-full px-2.5 py-2 text-[10px] font-semibold text-[#8b97ab] uppercase tracking-[0.16em] hover:bg-[#1d222b] flex items-center gap-1.5 transition-colors">
              {expandedCat === cat ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span style={{ color: schema.categories[cat]?.color }}>{cat}</span>
              <span className="text-[9px] opacity-60 ml-auto">{actions.length}</span>
            </button>
            {expandedCat === cat && actions.map(action => {
              const discriminator = action.syntax.split(/\s+/).slice(1, 3).join(" ") || action.variantId.split(".").at(-1) || "default"
              return (
                <div key={action.id} draggable
                  onDragStart={e => handleDragStart(e, action)}
                  className="kether-palette__item group mx-1 flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-[oklch(0.91_0.025_78)] cursor-grab"
                  title={`${action.description}\n${action.syntax}`}>
                  <GripVertical className="w-3 h-3 text-[oklch(0.58_0.055_34)] group-hover:text-[oklch(0.72_0.17_48)]" />
                  <span className="truncate max-w-[76px]">{action.name}</span>
                  <span className="border border-[oklch(0.44_0.09_35)] bg-[oklch(0.24_0.055_28)] px-1 py-0.5 text-[8px] text-[oklch(0.84_0.08_65)] truncate max-w-[82px]">{discriminator}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
