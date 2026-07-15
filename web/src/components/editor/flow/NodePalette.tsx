import { useCallback, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, GripVertical, MoveRight, PanelLeftOpen, Search } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  getKetherBuiltinColor,
  getKetherCategoryPresentation,
  matchesKetherCategoryQuery,
} from "./category-presentation"

interface NodePaletteProps {
  schema: ActionsSchemaV2
  onDragStart: (action: SchemaAction | { builtin: string }) => void
}

const BUILTIN_NODES = [
  { builtin: "set", category: "variable", label: "设置变量", description: "设置变量值" },
  { builtin: "if", category: "logic", label: "条件分支", description: "条件成立与否则分支" },
  { builtin: "for", category: "loop", label: "遍历循环", description: "遍历集合中的内容" },
  { builtin: "case", category: "logic", label: "多路分支", description: "按值进入不同分支" },
  { builtin: "check", category: "logic", label: "条件判断", description: "生成布尔判断结果" },
  { builtin: "any", category: "logic", label: "任一条件", description: "任一条件成立即通过" },
  { builtin: "all", category: "logic", label: "全部条件", description: "全部条件成立才通过" },
  { builtin: "math", category: "math", label: "数学运算", description: "基础数值运算" },
  { builtin: "calc", category: "math", label: "公式计算", description: "计算表达式结果" },
  { builtin: "sync", category: "flow", label: "同步块", description: "在同步上下文执行" },
  { builtin: "async", category: "flow", label: "异步块", description: "在异步上下文执行" },
  { builtin: "raw", category: "misc", label: "原始 Kether", description: "保留无法结构化的原文" },
]

interface PaletteItemProps {
  label: string
  meta: string
  description: string
  syntax?: string
  color: string
  dragValue: SchemaAction | { builtin: string }
  onDragStart: (event: React.DragEvent, value: SchemaAction | { builtin: string }) => void
}

export function PaletteItem({ label, meta, description, syntax, color, dragValue, onDragStart }: PaletteItemProps) {
  const normalizedDescription = description.trim() || "此节点暂未提供简介"
  const accessibleDescription = syntax
    ? `${label}：${normalizedDescription}。语法：${syntax}`
    : `${label}：${normalizedDescription}。标识：${meta}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          draggable
          tabIndex={0}
          onDragStart={(event) => onDragStart(event, dragValue)}
          className="kether-palette__item"
          aria-label={accessibleDescription}
        >
          <GripVertical className="kether-palette__item-icon" style={{ color }} aria-hidden />
          <span className="kether-palette__item-label">{label}</span>
          <code className="kether-palette__item-meta">{meta}</code>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="kether-palette__tooltip"
      >
        <div className="kether-palette__tooltip-heading">
          <strong>{label}</strong>
          <code>{meta}</code>
        </div>
        <p className="kether-palette__tooltip-description">{normalizedDescription}</p>
        {syntax && <code className="kether-palette__tooltip-syntax">{syntax}</code>}
      </TooltipContent>
    </Tooltip>
  )
}

function actionMatchesQuery(action: SchemaAction, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase("zh-CN")
  return action.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    || (action.aliases ?? []).some((alias) => alias.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    || action.description.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    || action.syntax.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
}

export function NodePalette({ schema, onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("")
  const [expandedCat, setExpandedCat] = useState<string | null>("$builtin")
  const [collapsed, setCollapsed] = useState(false)
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN")

  const categories = useMemo(() => {
    const result = new Map<string, SchemaAction[]>()
    for (const action of schema.actions) {
      if (!result.has(action.category)) result.set(action.category, [])
      result.get(action.category)?.push(action)
    }
    return result
  }, [schema])

  const filteredCategories = useMemo(() => {
    if (!normalizedSearch) return categories
    const result = new Map<string, SchemaAction[]>()
    for (const [category, actions] of categories) {
      const matched = matchesKetherCategoryQuery(category, normalizedSearch)
        ? actions
        : actions.filter((action) => actionMatchesQuery(action, normalizedSearch))
      if (matched.length > 0) result.set(category, matched)
    }
    return result
  }, [categories, normalizedSearch])

  const filteredBuiltins = useMemo(() => {
    if (!normalizedSearch) return BUILTIN_NODES
    return BUILTIN_NODES.filter((node) => (
      node.builtin.includes(normalizedSearch)
      || node.label.toLocaleLowerCase("zh-CN").includes(normalizedSearch)
      || node.description.toLocaleLowerCase("zh-CN").includes(normalizedSearch)
      || matchesKetherCategoryQuery(node.category, normalizedSearch)
    ))
  }, [normalizedSearch])

  const handleDragStart = useCallback((event: React.DragEvent, action: SchemaAction | { builtin: string }) => {
    event.dataTransfer.setData("application/kether-node", JSON.stringify(action))
    event.dataTransfer.effectAllowed = "move"
    onDragStart(action)
  }, [onDragStart])

  const showBuiltins = normalizedSearch ? filteredBuiltins.length > 0 : expandedCat === "$builtin"
  const hasResults = filteredBuiltins.length > 0 || filteredCategories.size > 0

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <aside className="kether-palette" data-collapsed={collapsed} aria-label="Kether 节点库">
      <header className="kether-palette__header">
        <div className="kether-palette__title-row">
          <span className="kether-palette__title">节点库</span>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="kether-palette__collapse"
            aria-expanded={!collapsed}
          >
            <PanelLeftOpen aria-hidden />
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
        <label className="kether-palette__search">
          <Search className="kether-palette__search-icon" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索节点或分类"
            className="kether-palette__search-input"
            aria-label="搜索节点或分类"
          />
        </label>
        <div className="kether-palette__hint">
          <MoveRight aria-hidden />
          拖到右侧画布创建节点
        </div>
      </header>

      <nav className="kether-palette__body" aria-label="节点分类">
        <section className="kether-palette__category">
          <button
            type="button"
            onClick={() => setExpandedCat(expandedCat === "$builtin" ? null : "$builtin")}
            className="kether-palette__category-button"
            data-expanded={showBuiltins}
            aria-expanded={showBuiltins}
          >
            {showBuiltins ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <span className="kether-palette__category-color" style={{ background: "var(--ke-symbol-teal)" }} aria-hidden />
            <span className="kether-palette__category-label">控制流</span>
            <span className="kether-palette__count">{filteredBuiltins.length}</span>
          </button>
          {showBuiltins && filteredBuiltins.map((node) => (
            <PaletteItem
              key={node.builtin}
              label={node.label}
              meta={node.builtin}
              description={node.description}
              color={getKetherBuiltinColor(node.builtin)}
              dragValue={node}
              onDragStart={handleDragStart}
            />
          ))}
        </section>

        {[...filteredCategories].map(([category, actions]) => {
          const presentation = getKetherCategoryPresentation(category)
          const expanded = normalizedSearch.length > 0 || expandedCat === category
          return (
            <section className="kether-palette__category" key={category}>
              <button
                type="button"
                onClick={() => setExpandedCat(expandedCat === category ? null : category)}
                className="kether-palette__category-button"
                data-expanded={expanded}
                aria-expanded={expanded}
                title={`原始分类：${category}`}
              >
                {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                <span className="kether-palette__category-color" style={{ background: presentation.color }} aria-hidden />
                <span className="kether-palette__category-label">{presentation.label}</span>
                <span className="kether-palette__count">{actions.length}</span>
              </button>
              {expanded && actions.map((action) => {
                const discriminator = action.syntax.split(/\s+/).slice(1, 3).join(" ") || action.variantId.split(".").at(-1) || "default"
                return (
                  <PaletteItem
                    key={action.id}
                    label={action.name}
                    meta={discriminator}
                    description={action.description}
                    syntax={action.syntax}
                    color={presentation.color}
                    dragValue={action}
                    onDragStart={handleDragStart}
                  />
                )
              })}
            </section>
          )
        })}

        {!hasResults && <div className="kether-palette__empty">未找到匹配节点</div>}
        </nav>
      </aside>
    </TooltipProvider>
  )
}
