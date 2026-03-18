import { useState, useMemo, useCallback } from "react"
import { ChevronDown, ChevronRight, Search, GripVertical } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"

interface NodePaletteProps {
  schema: ActionsSchemaV2
  onDragStart: (action: SchemaAction | { builtin: string }) => void
}

const BUILTIN_NODES = [
  { builtin: "set", label: "set 变量", description: "设置变量值" },
  { builtin: "if", label: "if 条件", description: "条件分支" },
  { builtin: "for", label: "for 循环", description: "遍历循环" },
  { builtin: "case", label: "case 匹配", description: "模式匹配" },
  { builtin: "calc", label: "calc 公式", description: "表达式计算" },
]

export function NodePalette({ schema, onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("")
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

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
    <div className="w-52 border-r border-[#3c3c3c] flex flex-col bg-[#252526] shrink-0 select-none">
      <div className="p-1.5 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-1 px-2 py-1 bg-[#3c3c3c] rounded">
          <Search className="w-3 h-3 text-[#858585]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索节点..." className="flex-1 text-[11px] bg-transparent border-none text-[#cccccc] focus:outline-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
          <button onClick={() => setExpandedCat(expandedCat === "$builtin" ? null : "$builtin")}
            className="w-full px-2 py-1.5 text-[11px] font-semibold text-[#858585] uppercase tracking-wider hover:bg-[#2a2d2e] flex items-center gap-1">
            {expandedCat === "$builtin" ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            控制流
          </button>
          {expandedCat === "$builtin" && BUILTIN_NODES.map(node => (
            <div key={node.builtin} draggable
              onDragStart={e => handleDragStart(e, node)}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e] cursor-grab">
              <GripVertical className="w-3 h-3 text-[#858585]" />
              <span>{node.label}</span>
            </div>
          ))}
        </div>

        {[...filtered].map(([cat, actions]) => (
          <div key={cat}>
            <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
              className="w-full px-2 py-1.5 text-[11px] font-semibold text-[#858585] uppercase tracking-wider hover:bg-[#2a2d2e] flex items-center gap-1">
              {expandedCat === cat ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span style={{ color: schema.categories[cat]?.color }}>{cat}</span>
              <span className="text-[9px] opacity-50 ml-auto">{actions.length}</span>
            </button>
            {expandedCat === cat && actions.map(action => (
              <div key={action.name} draggable
                onDragStart={e => handleDragStart(e, action)}
                className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e] cursor-grab"
                title={action.description}>
                <GripVertical className="w-3 h-3 text-[#858585]" />
                <span>{action.name}</span>
                <span className="text-[9px] text-[#858585] ml-auto truncate max-w-[60px]">{action.description}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
