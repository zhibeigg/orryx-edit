// actions-schema.json v2 类型定义

export interface SchemaType {
  widget: "number" | "text" | "toggle" | "select" | "selector" | "vector3" | "location" | "matrix" | "duration" | "port" | "list"
  color: string
  step?: number
}

export interface SchemaCategory {
  color: string
  icon: string
}

export interface SchemaInput {
  name: string
  key: string
  type: string
  required: boolean
  default: unknown
  description?: string
  keyword?: string
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface SchemaOutput {
  type: string
  description?: string
}

export interface SchemaSlot {
  name: string
  label: string
  multiple: boolean
  optional?: boolean
}

export interface SchemaProvide {
  name: string
  key: string
  type: string
  description?: string
}

export type FlowType = "normal" | "branch" | "loop" | "container"

export interface SchemaAction {
  name: string
  aliases?: string[]
  category: string
  namespace: string
  description: string
  example?: string
  builtin?: boolean
  inputs: SchemaInput[]
  output: SchemaOutput | null
  flow: FlowType
  slots?: SchemaSlot[]
  provides?: SchemaProvide[]
}

export interface SchemaSelector {
  name: string
  aliases?: string[]
  description: string
  params: { name: string; key: string; type: string; default?: unknown }[]
}

export interface ActionsSchemaV2 {
  version: 2
  types: Record<string, SchemaType>
  categories: Record<string, SchemaCategory>
  actions: SchemaAction[]
  selectors: SchemaSelector[]
  triggers?: unknown[]
}

// ============ v1 → v2 兼容层 ============

const DEFAULT_TYPES: Record<string, SchemaType> = {
  DOUBLE:    { widget: "number",   color: "#6366f1" },
  INT:       { widget: "number",   color: "#6366f1", step: 1 },
  STRING:    { widget: "text",     color: "#db2777" },
  BOOLEAN:   { widget: "toggle",   color: "#f59e0b" },
  CONTAINER: { widget: "selector", color: "#d97706" },
  VECTOR:    { widget: "vector3",  color: "#10b981" },
  LOCATION:  { widget: "location", color: "#10b981" },
  DURATION:  { widget: "duration", color: "#06b6d4" },
  ACTION:    { widget: "port",     color: "#6b7280" },
  ANY:       { widget: "text",     color: "#6b7280" },
  // 小写类型名（actions-schema.json v1 使用）
  number:    { widget: "number",   color: "#6366f1" },
  int:       { widget: "number",   color: "#6366f1", step: 1 },
  long:      { widget: "number",   color: "#6366f1", step: 1 },
  text:      { widget: "text",     color: "#db2777" },
  boolean:   { widget: "toggle",   color: "#f59e0b" },
  selector:  { widget: "selector", color: "#d97706" },
  any:       { widget: "text",     color: "#6b7280" },
  keyword:   { widget: "text",     color: "#9ca3af" },
}

const DEFAULT_CATEGORY: SchemaCategory = { color: "#6b7280", icon: "puzzle" }

// v1 schema 类型定义
interface V1Action {
  name: string
  aliases?: string[]
  category?: string
  namespace?: string
  description?: string
  builtin?: boolean
  params?: Record<string, unknown>[]
  inputs?: Record<string, unknown>[]
  output?: unknown
  flow?: string
  slots?: unknown[]
  provides?: unknown[]
}

interface V1Selector {
  name: string
  aliases?: string[]
  description?: string
  params?: Record<string, unknown>[]
}

interface V1Schema {
  version?: 1
  types?: Record<string, unknown>
  categories?: Record<string, unknown>
  actions?: V1Action[]
  selectors?: V1Selector[]
  triggers?: unknown[]
}

/** 将 v1 或 v2 schema 统一转为 v2 格式 */
export function normalizeSchema(raw: V1Schema | ActionsSchemaV2): ActionsSchemaV2 {
  if (raw?.version === 2) return raw as ActionsSchemaV2

  // v1 → v2
  const actions: SchemaAction[] = (raw?.actions ?? []).map((a: V1Action) => {
    const params: Record<string, unknown>[] = a.params ?? a.inputs ?? []
    return {
      name: a.name,
      aliases: a.aliases ?? [],
      category: a.category ?? "未分类",
      namespace: a.namespace ?? "default",
      description: a.description ?? "",
      builtin: a.builtin ?? false,
      inputs: params.map((p: Record<string, unknown>) => ({
        name: p.name as string,
        key: (p.key ?? p.name) as string,
        type: (p.type ?? "ANY") as string,
        required: p.required ?? !(p.optional ?? false),
        default: p.default ?? null,
        description: (p.description ?? "") as string,
        keyword: p.keyword,
        options: p.options,
        min: p.min,
        max: p.max,
        step: p.step,
      })),
      output: a.output ? (typeof a.output === 'string' ? { type: a.output } : a.output as SchemaOutput) : null,
      flow: (a.flow && ["normal", "branch", "loop", "container"].includes(a.flow) ? a.flow : "normal") as FlowType,
      slots: a.slots as SchemaSlot[] | undefined,
      provides: a.provides as SchemaProvide[] | undefined,
    }
  })

  const selectors: SchemaSelector[] = (raw?.selectors ?? []).map((s: V1Selector) => ({
    name: s.name,
    aliases: s.aliases ?? [],
    description: s.description ?? "",
    params: (s.params ?? []).map((p: Record<string, unknown>) => ({
      name: p.name as string,
      key: (p.key ?? p.name) as string,
      type: (p.type ?? "STRING") as string,
      default: p.default,
    })),
  }))

  // 从 actions 收集 categories
  const categories: Record<string, SchemaCategory> = (raw?.categories ?? {}) as Record<string, SchemaCategory>
  for (const a of actions) {
    if (!categories[a.category]) {
      categories[a.category] = { ...DEFAULT_CATEGORY }
    }
  }

  return {
    version: 2,
    types: (raw?.types ?? DEFAULT_TYPES) as Record<string, SchemaType>,
    categories,
    actions,
    selectors,
    triggers: raw?.triggers,
  }
}
