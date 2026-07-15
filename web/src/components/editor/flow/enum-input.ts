import { keywordAlternatives, type SchemaInput, type SchemaType } from "@/types/schema"

export const ENUM_RESULT_LIMIT = 80

export interface FilteredEnumOptions {
  values: string[]
  total: number
  truncated: boolean
}

function uniqueOptions(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

/** input 专属目录优先，其次使用类型级枚举，最后回退到 keyword alternatives。 */
export function resolveEnumOptions(input: SchemaInput, type?: SchemaType): string[] {
  const inputOptions = uniqueOptions(input.options ?? [])
  if (inputOptions.length > 0) return inputOptions
  const typeOptions = uniqueOptions(type?.enumValues ?? [])
  if (typeOptions.length > 0) return typeOptions
  return uniqueOptions(keywordAlternatives(input))
}

export function filterEnumOptions(
  options: readonly string[],
  query: string,
  limit = ENUM_RESULT_LIMIT,
): FilteredEnumOptions {
  const needle = query.trim().toLocaleLowerCase()
  const matches = needle
    ? options.filter((option) => option.toLocaleLowerCase().includes(needle))
    : [...options]
  return {
    values: matches.slice(0, Math.max(0, limit)),
    total: matches.length,
    truncated: matches.length > limit,
  }
}

export function nextEnumActiveIndex(
  current: number,
  count: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  if (count <= 0) return -1
  if (key === "Home") return 0
  if (key === "End") return count - 1
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count
  return current < 0 ? count - 1 : (current - 1 + count) % count
}
