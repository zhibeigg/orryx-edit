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

/**
 * 从同名 action 的多个重载中，根据文本内容选择最匹配的重载。
 * 通过检查文本中是否包含某个重载的 keyword 来判断。
 */
export function findBestOverload(name: string, line: string, schema: ActionsSchemaV2): SchemaAction | null {
  const lower = name.toLowerCase()
  const candidates = schema.actions.filter(a =>
    a.name.toLowerCase() === lower || (a.aliases ?? []).some(al => al.toLowerCase() === lower)
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // 对每个重载，计算它的 keyword 在文本中的匹配数
  const lineTokens = new Set(line.trim().toLowerCase().split(/\s+/))
  let bestScore = -1
  let best: SchemaAction = candidates[0]

  for (const candidate of candidates) {
    let score = 0
    for (const input of candidate.inputs ?? []) {
      if (!input.keyword) continue
      // 支持 "set/to" 复合 keyword
      const kwParts = input.keyword.toLowerCase().split("/")
      if (kwParts.some(kw => lineTokens.has(kw))) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

export function generateKetherText(action: SchemaAction, values: Record<string, unknown>): string {
  const parts: string[] = [action.name]

  // 按 schema inputs 原始顺序输出，保持 keyword 和位置参数的相对位置
  for (const input of action.inputs ?? []) {
    const val = values[input.key]

    if (input.keyword) {
      if (val == null) continue
      // 标记型 keyword (type === "keyword")：值是 keyword 的某个部分，只输出一次
      if (input.type === "keyword") {
        const kwParts = input.keyword.toLowerCase().split("/")
        const valLower = String(val).toLowerCase()
        if (kwParts.includes(valLower)) {
          parts.push(String(val))
        } else {
          parts.push(kwParts[0])
        }
      } else {
        // 前缀型 keyword：输出 keyword + value
        if (val === input.default) continue
        const kwParts = input.keyword.split("/")
        parts.push(kwParts[0])
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
export function parseLineValues(line: string, action: SchemaAction, schema?: ActionsSchemaV2): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const tokens = tokenizeLine(line.trim())
  if (tokens.length === 0) return values

  tokens.shift() // skip action name

  // 构建已知 action 查找表（用于嵌套表达式消费）
  const actionLookup = new Map<string, SchemaAction>()
  if (schema) {
    for (const a of schema.actions) {
      const n = a.name.toLowerCase()
      if (!actionLookup.has(n)) actionLookup.set(n, a)
      for (const al of a.aliases ?? []) {
        const aln = al.toLowerCase()
        if (!actionLookup.has(aln)) actionLookup.set(aln, a)
      }
    }
  }

  const inputs = action.inputs ?? []
  const keywordMap = new Map<string, SchemaInput>()
  for (const input of inputs) {
    if (input.keyword) {
      // 支持 "set/to" 复合 keyword — 每个部分都注册
      for (const kw of input.keyword.toLowerCase().split("/")) {
        keywordMap.set(kw, input)
      }
    } else if (!input.required && input.key) {
      // 没有 keyword 字段但 key 出现在 token 列表中 → 当作隐式 keyword
      // 处理 schema 中 they/source/type 等没有标注 keyword 但实际是 keyword 的情况
      const keyLower = input.key.toLowerCase()
      if (tokens.some(t => t.toLowerCase() === keyLower)) {
        keywordMap.set(keyLower, input)
      }
    }
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
      // 标记型 keyword：type 为 "keyword"，keyword 本身就是值（如 set/to、remove/delete）
      // 前缀型 keyword：type 为具体类型，keyword 后面跟一个值（如 level 3、timeout 200）
      const isMarkerKeyword = kwInput.type === "keyword"

      if (isMarkerKeyword) {
        values[kwInput.key] = tok
        i++
      } else {
        i++ // consume keyword
        if (i < tokens.length) {
          const { value, nextIndex } = consumeExpression(tokens, i, actionLookup)
          values[kwInput.key] = value
          i = nextIndex
        }
      }
      continue
    }

    // 消费位置参数
    if (posIdx < positional.length) {
      const param = positional[posIdx]
      // selector 类型参数：如果当前 token 是 "they"，跳过它取下一个 token 作为值
      if (param.type === "selector" && lower === "they" && i + 1 < tokens.length) {
        i++ // skip "they"
      }
      const { value, nextIndex } = consumeExpression(tokens, i, actionLookup)
      values[param.key] = value
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
 * 处理多 token 表达式：lazy *var、math add [ 1 2 ]、range 1 to 10、{ ... } 等。
 * 返回合并后的字符串值和下一个 token 的索引。
 */
function consumeExpression(
  tokens: string[],
  startIdx: number,
  actionLookup: Map<string, SchemaAction> = new Map()
): { value: string; nextIndex: number } {
  if (startIdx >= tokens.length) return { value: "", nextIndex: startIdx }

  const tok = tokens[startIdx]
  const lower = tok.toLowerCase()

  // { ... } 或 [ ... ] 块 — tokenizeLine 已经把它们合并为一个 token
  if (tok.startsWith("{") || tok.startsWith("[")) {
    return { value: tok, nextIndex: startIdx + 1 }
  }

  // lazy/not + 下一个 token
  if (EXPRESSION_PREFIXES.has(lower) && startIdx + 1 < tokens.length) {
    const inner = consumeExpression(tokens, startIdx + 1, actionLookup)
    return { value: tok + " " + inner.value, nextIndex: inner.nextIndex }
  }

  // math/any/all + OP + [ ... ]
  if (BRACKET_PREFIXES.has(lower)) {
    let end = startIdx + 1
    if (lower === "math" && end < tokens.length) end++
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

  // 已知 action 名 → 按 schema 参数结构递归消费
  const nestedAction = actionLookup.get(lower)
  if (nestedAction) {
    const parts: string[] = [tok]
    let idx = startIdx + 1
    const nestedInputs = nestedAction.inputs ?? []

    for (const input of nestedInputs) {
      if (idx >= tokens.length) break
      const curTok = tokens[idx]

      if (input.keyword) {
        const kwParts = input.keyword.toLowerCase().split("/")
        if (kwParts.includes(curTok.toLowerCase())) {
          if (input.type === "keyword") {
            parts.push(curTok)
            idx++
          } else {
            parts.push(curTok)
            idx++
            if (idx < tokens.length) {
              const inner = consumeExpression(tokens, idx, actionLookup)
              parts.push(inner.value)
              idx = inner.nextIndex
            }
          }
        }
        // keyword 不匹配则跳过
      } else if (input.required) {
        // required 位置参数：始终消费
        const inner = consumeExpression(tokens, idx, actionLookup)
        parts.push(inner.value)
        idx = inner.nextIndex
      } else {
        // optional 位置参数：只消费明确的值 token（数字、引号、块、*、&）
        // 避免贪婪消费外层的 keyword
        if (/^-?\d/.test(curTok) || curTok.startsWith('"') || curTok.startsWith('{') || curTok.startsWith('[') || curTok.startsWith('*') || curTok.startsWith('&')) {
          const inner = consumeExpression(tokens, idx, actionLookup)
          parts.push(inner.value)
          idx = inner.nextIndex
        }
        // 否则跳过，不消费
      }
    }
    return { value: parts.join(" "), nextIndex: idx }
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
