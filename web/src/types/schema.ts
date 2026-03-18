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
