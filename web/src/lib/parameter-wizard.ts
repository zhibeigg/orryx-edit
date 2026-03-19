import type { ActionsSchemaV2, SchemaAction, SchemaInput } from "@/types/schema"

export interface WizardState {
  action: SchemaAction
  values: Record<string, unknown>
  position: { lineNumber: number; column: number }
  isEditing: boolean
}

export function findAction(name: string, schema: ActionsSchemaV2): SchemaAction | null {
  const lower = name.toLowerCase()
  return schema.actions.find(a =>
    a.name.toLowerCase() === lower || (a.aliases ?? []).some(al => al.toLowerCase() === lower)
  ) ?? null
}

export function generateKetherText(action: SchemaAction, values: Record<string, unknown>): string {
  const parts: string[] = [action.name]

  for (const input of (action.inputs ?? []).filter(p => !p?.keyword)) {
    const val = values[input.key]
    if (val == null && !input.required) continue
    parts.push(formatValue(val, input))
  }

  for (const input of (action.inputs ?? []).filter(p => p?.keyword)) {
    const val = values[input.key]
    if (val == null || val === input.default) continue
    parts.push(input.keyword!)
    parts.push(formatValue(val, input))
  }

  return parts.join(" ")
}

function formatValue(value: unknown, input: SchemaInput): string {
  if (value == null) return String(input.default ?? "")
  if (input.type === "STRING" || input.type === "CONTAINER") {
    const s = String(value)
    return s.includes(" ") || s.startsWith("@") ? `"${s}"` : s
  }
  return String(value)
}

export function parseLineValues(line: string, action: SchemaAction): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const tokens = tokenizeLine(line)
  if (tokens.length === 0) return values

  tokens.shift() // skip action name
  const positional = (action.inputs ?? []).filter(p => !p?.keyword)
  let posIdx = 0

  let i = 0
  while (i < tokens.length) {
    const kw = (action.inputs ?? []).find(p => p?.keyword?.toLowerCase() === tokens[i].toLowerCase())
    if (kw) {
      i++
      if (i < tokens.length) { values[kw.key] = tokens[i]; i++ }
    } else if (posIdx < positional.length) {
      values[positional[posIdx].key] = tokens[i]
      posIdx++; i++
    } else { i++ }
  }
  return values
}

function tokenizeLine(line: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === " " || line[i] === "\t") { i++; continue }
    if (line[i] === '"') {
      i++; let s = ""
      while (i < line.length && line[i] !== '"') { s += line[i]; i++ }
      if (i < line.length) i++
      tokens.push(s)
    } else {
      let s = ""
      while (i < line.length && line[i] !== " " && line[i] !== "\t") { s += line[i]; i++ }
      tokens.push(s)
    }
  }
  return tokens
}
