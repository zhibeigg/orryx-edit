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

  // 按 schema inputs 原始顺序输出，保持 keyword 和位置参数的相对位置
  for (const input of action.inputs ?? []) {
    const val = values[input.key]

    if (input.keyword) {
      if (val == null) continue
      // 标记型 keyword：值等于 keyword 本身，只输出一次（不输出 keyword value 两个 token）
      if (String(val).toLowerCase() === input.keyword.toLowerCase()) {
        parts.push(input.keyword)
      } else {
        // 值等于 default 时跳过（非标记型）
        if (val === input.default) continue
        parts.push(input.keyword)
        parts.push(formatValue(val, input))
      }
    } else {
      if (val == null && !input.required) continue
      const formatted = formatValue(val, input)
      if (formatted !== "") parts.push(formatted)
    }
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

// 需要合并后续 token 的前缀关键字（它们后面跟一个表达式作为整体）
const EXPRESSION_PREFIXES = new Set(["lazy", "not"])

// 需要合并 OP + [ ... ] 的前缀
const BRACKET_PREFIXES = new Set(["math", "any", "all"])

/**
 * 从一行 Kether 文本中解析参数值。
 * 基于 token 级别匹配，支持嵌套块和多 token 表达式合并。
 */
export function parseLineValues(line: string, action: SchemaAction): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const tokens = tokenizeLine(line.trim())
  if (tokens.length === 0) return values

  tokens.shift() // skip action name

  const inputs = action.inputs ?? []
  const keywordMap = new Map<string, SchemaInput>()
  for (const input of inputs) {
    if (input.keyword) keywordMap.set(input.keyword.toLowerCase(), input)
  }
  const positional = inputs.filter(p => !p?.keyword)
  let posIdx = 0
  let i = 0

  while (i < tokens.length) {
    const tok = tokens[i]
    const lower = tok.toLowerCase()

    // 检查是否匹配某个 keyword 参数
    const kwInput = keywordMap.get(lower)
    if (kwInput) {
      // 判断是"标记型 keyword"还是"前缀型 keyword"
      // 标记型：keyword 本身就是值（如 potion set / cooldown get）
      //   → 后面还有未消费的位置参数，keyword 后的 token 属于位置参数
      // 前缀型：keyword 后面跟一个值（如 level 3 / they "@self"）
      //   → 后面没有未消费的位置参数了
      const hasRemainingPositional = posIdx < positional.length
      const nextTok = i + 1 < tokens.length ? tokens[i + 1].toLowerCase() : null
      const isMarkerKeyword =
        // 后面还有位置参数要消费，keyword 后的 token 应该给位置参数
        hasRemainingPositional ||
        // 下一个 token 是另一个 keyword 标记
        (nextTok !== null && keywordMap.has(nextTok)) ||
        // 没有下一个 token
        nextTok === null

      if (isMarkerKeyword) {
        // 标记型：值就是 keyword 本身
        values[kwInput.key] = tok
        i++
      } else {
        // 前缀型：消费 keyword + 后面的值
        i++ // consume keyword
        const { value, nextIndex } = consumeExpression(tokens, i)
        values[kwInput.key] = value
        i = nextIndex
      }
      continue
    }

    // 消费位置参数
    if (posIdx < positional.length) {
      const { value, nextIndex } = consumeExpression(tokens, i)
      values[positional[posIdx].key] = value
      posIdx++
      i = nextIndex
    } else {
      // 没有更多参数定义了，跳过
      i++
    }
  }

  return values
}

/**
 * 从 tokens[startIdx] 开始消费一个"表达式值"。
 * 处理多 token 表达式：lazy *var、math add [ 1 2 ]、check a == b、{ ... } 等。
 * 返回合并后的字符串值和下一个 token 的索引。
 */
function consumeExpression(tokens: string[], startIdx: number): { value: string; nextIndex: number } {
  if (startIdx >= tokens.length) return { value: "", nextIndex: startIdx }

  const tok = tokens[startIdx]
  const lower = tok.toLowerCase()

  // { ... } 或 [ ... ] 块 — tokenizeLine 已经把它们合并为一个 token
  if (tok.startsWith("{") || tok.startsWith("[")) {
    return { value: tok, nextIndex: startIdx + 1 }
  }

  // lazy/not + 下一个 token
  if (EXPRESSION_PREFIXES.has(lower) && startIdx + 1 < tokens.length) {
    const inner = consumeExpression(tokens, startIdx + 1)
    return { value: tok + " " + inner.value, nextIndex: inner.nextIndex }
  }

  // math/any/all + OP + [ ... ]
  if (BRACKET_PREFIXES.has(lower)) {
    let end = startIdx + 1
    // math 后面还有一个操作符 token（如 div/mul/add）
    if (lower === "math" && end < tokens.length) end++
    // 然后是 [ ... ] 块
    if (end < tokens.length && tokens[end].startsWith("[")) end++
    const merged = tokens.slice(startIdx, end).join(" ")
    return { value: merged, nextIndex: end }
  }

  // calc/inline + 引号字符串
  if ((lower === "calc" || lower === "inline") && startIdx + 1 < tokens.length) {
    return { value: tok + " " + tokens[startIdx + 1], nextIndex: startIdx + 2 }
  }

  // check + left + op + right
  if (lower === "check" && startIdx + 3 < tokens.length) {
    const merged = tokens.slice(startIdx, startIdx + 4).join(" ")
    return { value: merged, nextIndex: startIdx + 4 }
  }

  // 普通单 token
  return { value: tok, nextIndex: startIdx + 1 }
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
    } else if (line[i] === "{" || line[i] === "[") {
      const open = line[i]
      const close = open === "{" ? "}" : "]"
      let depth = 1
      let s = open
      i++
      while (i < line.length && depth > 0) {
        if (line[i] === open) depth++
        else if (line[i] === close) depth--
        s += line[i]
        i++
      }
      tokens.push(s)
    } else {
      let s = ""
      while (i < line.length && line[i] !== " " && line[i] !== "\t") { s += line[i]; i++ }
      tokens.push(s)
    }
  }
  return tokens
}
