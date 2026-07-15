import type { SchemaAction, ActionsSchemaV2 } from "@/types/schema"

const MECHANICAL_PALETTE = [
  "oklch(0.56 0.13 34)",
  "oklch(0.62 0.15 42)",
  "oklch(0.68 0.16 50)",
  "oklch(0.48 0.11 27)",
  "oklch(0.60 0.10 58)",
]

function stablePaletteColor(value: string): string {
  let hash = 0
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0
  return MECHANICAL_PALETTE[Math.abs(hash) % MECHANICAL_PALETTE.length] ?? MECHANICAL_PALETTE[0]
}

export function getNodeColor(action: SchemaAction, schema: ActionsSchemaV2) {
  return schema.categories[action.category]?.color ?? stablePaletteColor(`${action.namespace}:${action.category}`)
}

export function getPortColor(typeName: string, schema: ActionsSchemaV2) {
  const normalized = typeName.toLowerCase()
  if (normalized === "boolean" || normalized === "predicate") return "oklch(0.70 0.16 48)"
  if (["number", "int", "long", "float", "double", "duration"].includes(normalized)) return "oklch(0.76 0.13 70)"
  if (["text", "string", "keyword", "enum"].includes(normalized)) return "oklch(0.72 0.12 38)"
  if (["raw", "selector", "location", "vector3", "matrix"].includes(normalized)) return "oklch(0.62 0.08 30)"
  return schema.types[typeName]?.color?.startsWith("oklch") ? schema.types[typeName].color : "oklch(0.58 0.09 36)"
}

export const BUILTIN_COLORS: Record<string, string> = {
  set: "oklch(0.56 0.12 38)",
  if: "oklch(0.68 0.16 48)",
  for: "oklch(0.62 0.14 42)",
  case: "oklch(0.58 0.13 35)",
  calc: "oklch(0.72 0.12 65)",
  data: "oklch(0.55 0.08 32)",
  var_ref: "oklch(0.62 0.10 45)",
  string: "oklch(0.66 0.12 38)",
  number: "oklch(0.74 0.13 67)",
  boolean: "oklch(0.69 0.15 48)",
  raw: "oklch(0.48 0.08 28)",
}
