import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import { getKetherCategoryColor } from "../category-presentation"

export function getNodeColor(action: SchemaAction): string {
  return getKetherCategoryColor(action.category)
}

export function getPortColor(typeName: string, schema: ActionsSchemaV2): string {
  const normalized = typeName.toLocaleLowerCase("zh-CN")
  const widget = schema.types[typeName]?.widget ?? schema.types[normalized]?.widget
  if (normalized === "boolean" || normalized === "predicate" || widget === "toggle") return "var(--ke-symbol-blue)"
  if (["number", "int", "long", "float", "double", "decimal", "duration"].includes(normalized) || widget === "number" || widget === "duration") return "var(--ke-symbol-yellow)"
  if (["text", "string", "keyword", "enum"].includes(normalized) || widget === "text" || widget === "select") return "var(--ke-symbol-coral)"
  if (["raw", "selector", "location", "vector3", "matrix", "list", "set", "map"].includes(normalized) || widget === "raw" || widget === "selector" || widget === "location" || widget === "vector3" || widget === "matrix" || widget === "list") return "var(--ke-symbol-teal)"
  return "var(--ke-symbol-blue)"
}

export const BUILTIN_COLORS: Record<string, string> = {
  set: "var(--ke-symbol-yellow)",
  if: "var(--ke-symbol-teal)",
  for: "var(--ke-symbol-teal)",
  case: "var(--ke-symbol-teal)",
  calc: "var(--ke-symbol-yellow)",
  data: "var(--ke-symbol-blue)",
  var_ref: "var(--ke-symbol-blue)",
  string: "var(--ke-symbol-coral)",
  number: "var(--ke-symbol-yellow)",
  boolean: "var(--ke-symbol-blue)",
  raw: "var(--ke-symbol-coral)",
}
