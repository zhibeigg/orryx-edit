import { useState, useMemo, useCallback } from "react"
import { ChevronDown, ChevronRight, Search, GripVertical, MoveRight } from "lucide-react"
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
  const [expandedCat, setExpandedCat] = useState<string | null>("$builtin")

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
    <div className="w-56 max-md:w-full max-md:max-h-52 border-r max-md:border-r-0 max-md:border-b border-[#2f3136] flex flex-col bg-[#14171d] shrink-0 select-none">
      <div className="p-2 border-b border-[#2f3136] bg-[#171a21]">
        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#748093]">节点库</div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#1f242d] rounded-md border border-[#303643] focus-within:border-[#5794d9] transition-colors">
          <Search className="w-3 h-3 text-[#7f8a9b]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索 action / alias..." className="flex-1 text-[11px] bg-transparent border-none text-[#c6cedb] focus:outline-none placeholder:text-[#677488]" />
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10px] text-[#6f7b8f]">
          <MoveRight className="w-3 h-3" />
          拖拽到右侧画布即可创建节点
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-md:overflow-x-auto">
        <div>
          <button onClick={() => setExpandedCat(expandedCat === "$builtin" ? null : "$builtin")}
            className="w-full px-2.5 py-2 text-[10px] font-semibold text-[#8b97ab] uppercase tracking-[0.16em] hover:bg-[#1d222b] flex items-center gap-1.5 transition-colors">
            {expandedCat === "$builtin" ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            控制流
          </button>
          {expandedCat === "$builtin" && BUILTIN_NODES.map(node => (
            <div key={node.builtin} draggable
              onDragStart={e => handleDragStart(e, node)}
              className="group flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[#c6cedb] hover:bg-[#202633] cursor-grab border-l border-transparent hover:border-[#5b95d7] transition-all">
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
            {expandedCat === cat && actions.map(action => (
              <div key={action.name} draggable
                onDragStart={e => handleDragStart(e, action)}
                className="group flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[#c6cedb] hover:bg-[#202633] cursor-grab border-l border-transparent hover:border-[#5b95d7] transition-all"
                title={action.description}>
                <GripVertical className="w-3 h-3 text-[#6f7b8f] group-hover:text-[#94b8e4]" />
                <span className="truncate max-w-[84px]">{action.name}</span>
                <span className="text-[9px] text-[#6f7b8f] ml-auto truncate max-w-[74px]">{action.description}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
