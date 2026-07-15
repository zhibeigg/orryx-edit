const CATEGORY_LABELS: Record<string, string> = {
  core: "核心",
  player: "玩家",
  platform: "平台",
  flow: "流程",
  data: "数据",
  output: "输出",
  logic: "逻辑",
  variable: "变量",
  loop: "循环",
  math: "数学",
  game: "游戏",
  time: "时间",
  combat: "战斗",
  entity: "实体",
  compat: "兼容",
  misc: "其他",
  particle: "粒子",
  movement: "移动",
  selector: "选择器",
  sound: "音效",
  world: "世界",
  control: "控制",
  event: "事件",
  inventory: "背包",
  item: "物品",
  effect: "效果",
  system: "系统",
  network: "网络",
  database: "数据库",
  uncategorized: "未分类",
}

type CategoryTone = "blue" | "teal" | "yellow" | "coral"

const CATEGORY_TONES: Record<string, CategoryTone> = {
  core: "blue",
  player: "blue",
  platform: "blue",
  game: "blue",
  selector: "blue",
  world: "blue",
  event: "blue",
  flow: "teal",
  logic: "teal",
  loop: "teal",
  data: "teal",
  output: "teal",
  movement: "teal",
  network: "teal",
  variable: "yellow",
  math: "yellow",
  time: "yellow",
  entity: "yellow",
  inventory: "yellow",
  item: "yellow",
  database: "yellow",
  combat: "coral",
  particle: "coral",
  sound: "coral",
  compat: "coral",
  misc: "coral",
  effect: "coral",
  system: "coral",
  uncategorized: "coral",
}

const TONE_COLORS: Record<CategoryTone, string> = {
  blue: "var(--ke-symbol-blue)",
  teal: "var(--ke-symbol-teal)",
  yellow: "var(--ke-symbol-yellow)",
  coral: "var(--ke-symbol-coral)",
}

const BUILTIN_CATEGORIES: Record<string, string> = {
  set: "variable",
  if: "logic",
  for: "loop",
  case: "logic",
  check: "logic",
  any: "logic",
  all: "logic",
  math: "math",
  calc: "math",
  sync: "flow",
  async: "flow",
  raw: "misc",
}

export interface KetherCategoryPresentation {
  id: string
  label: string
  color: string
}

export function normalizeKetherCategoryId(category: string): string {
  return category.trim().toLocaleLowerCase("zh-CN")
}

export function getKetherCategoryPresentation(category: string): KetherCategoryPresentation {
  const id = normalizeKetherCategoryId(category) || "uncategorized"
  return {
    id,
    label: CATEGORY_LABELS[id] ?? `其他 · ${category.trim() || "未命名"}`,
    color: TONE_COLORS[CATEGORY_TONES[id] ?? "blue"],
  }
}

export function getKetherCategoryColor(category: string): string {
  return getKetherCategoryPresentation(category).color
}

export function getKetherBuiltinColor(builtin: string): string {
  return getKetherCategoryColor(BUILTIN_CATEGORIES[normalizeKetherCategoryId(builtin)] ?? "flow")
}

export function matchesKetherCategoryQuery(category: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  if (!normalizedQuery) return true
  const presentation = getKetherCategoryPresentation(category)
  return presentation.id.includes(normalizedQuery)
    || presentation.label.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
}
