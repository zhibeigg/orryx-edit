import type { SchemaAction, ActionsSchemaV2 } from "@/types/schema"

// 根据 schema category 获取节点颜色
export function getNodeColor(action: SchemaAction, schema: ActionsSchemaV2) {
  const cat = schema?.categories?.[action.category]
  return cat?.color ?? "#6b7280"
}

// 根据 schema type 获取端口颜色
export function getPortColor(typeName: string, schema: ActionsSchemaV2) {
  const t = schema?.types?.[typeName]
  return t?.color ?? "#6b7280"
}

// 节点类型 → 默认颜色（内置节点用）
export const BUILTIN_COLORS: Record<string, string> = {
  set: "#16a34a",
  if: "#ea580c",
  for: "#ea580c",
  case: "#ea580c",
  calc: "#06b6d4",
  data: "#6366f1",
  var_ref: "#16a34a",
  string: "#db2777",
  number: "#6366f1",
  boolean: "#f59e0b",
}
