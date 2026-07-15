export type NumberMode = "integer" | "float"

export interface NumberDraftOptions {
  mode?: NumberMode
  min?: number
  max?: number
}

/** 判断数字草稿是否仍可能成为合法数字，供输入中间态与测试使用。 */
export function isPotentialNumberDraft(draft: string, mode: NumberMode = "float"): boolean {
  if (draft === "" || draft === "-" || draft === "+") return true
  if (mode === "integer") return /^[+-]?\d*$/.test(draft)
  return /^[+-]?(?:\d+\.?\d*|\.\d*)$/.test(draft)
}

/** blur/Enter 时解析数字；无效草稿返回 null，由控件恢复外部值。 */
export function commitNumberDraft(draft: string, options: NumberDraftOptions = {}): number | null {
  const trimmed = draft.trim()
  if (trimmed === "" || !isPotentialNumberDraft(trimmed, options.mode)) return null

  const value = options.mode === "integer" ? Number.parseInt(trimmed, 10) : Number(trimmed)
  if (!Number.isFinite(value)) return null
  if (options.min !== undefined && value < options.min) return options.min
  if (options.max !== undefined && value > options.max) return options.max
  return value
}

/** 变量值提交时仅把完整数字转换为 number，空串与表达式保持字符串。 */
export function commitVariableValueDraft(draft: string): string | number {
  if (draft === "") return ""
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(draft)) {
    const value = Number(draft)
    if (Number.isFinite(value)) return value
  }
  return draft
}

/** 在保持对象条目顺序的同时提交变量键名。 */
export function renameRecordKey<T>(record: Record<string, T>, oldKey: string, newKey: string): Record<string, T> | null {
  const trimmed = newKey.trim()
  if (!trimmed || (trimmed !== oldKey && trimmed in record)) return null
  if (trimmed === oldKey) return record

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key === oldKey ? trimmed : key, value])
  )
}

export function parseCommaListDraft(draft: string): string[] {
  return draft.split(",").map((item) => item.trim()).filter(Boolean)
}

export function parseLineListDraft(draft: string): string[] {
  return draft.split("\n").map((item) => item.trim()).filter(Boolean)
}
