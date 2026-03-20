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

/** 将 v1 或 v2 schema 统一转为 v2 格式 */
export function normalizeSchema(raw: any): ActionsSchemaV2 {
  if (raw?.version === 2) return raw as ActionsSchemaV2

  // v1 → v2
  const actions: SchemaAction[] = (raw?.actions ?? []).map((a: any) => {
    const params: any[] = a.params ?? a.inputs ?? []
    return {
      name: a.name,
      aliases: a.aliases ?? [],
      category: a.category ?? "未分类",
      namespace: a.namespace ?? "default",
      description: a.description ?? "",
      builtin: a.builtin ?? false,
      inputs: params.map((p: any) => ({
        name: p.name,
        key: p.key ?? p.name,
        type: p.type ?? "ANY",
        required: p.required ?? !(p.optional ?? false),
        default: p.default ?? null,
        description: p.description ?? "",
        keyword: p.keyword,
        options: p.options,
        min: p.min,
        max: p.max,
        step: p.step,
      })),
      output: a.output ?? null,
      flow: a.flow ?? "normal",
      slots: a.slots,
      provides: a.provides,
    }
  })

  const selectors: SchemaSelector[] = (raw?.selectors ?? []).map((s: any) => ({
    name: s.name,
    aliases: s.aliases ?? [],
    description: s.description ?? "",
    params: (s.params ?? []).map((p: any) => ({
      name: p.name,
      key: p.key ?? p.name,
      type: p.type ?? "STRING",
      default: p.default,
    })),
  }))

  // 从 actions 收集 categories
  const categories: Record<string, SchemaCategory> = raw?.categories ?? {}
  for (const a of actions) {
    if (!categories[a.category]) {
      categories[a.category] = { ...DEFAULT_CATEGORY }
    }
  }

  return {
    version: 2,
    types: raw?.types ?? DEFAULT_TYPES,
    categories,
    actions,
    selectors,
    triggers: raw?.triggers,
  }
}
