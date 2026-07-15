import {
  buildSchemaCatalog,
  catalogActionsForName,
  keywordAlternatives,
  selectActionVariant,
  type ActionsSchemaV2,
  type SchemaAction,
  type SchemaInput,
} from "@/types/schema"

export interface WizardState {
  action: SchemaAction
  values: Record<string, unknown>
  position: { lineNumber: number; column: number }
  isEditing: boolean
}

export function findAction(name: string, schema: ActionsSchemaV2): SchemaAction | null {
  return catalogActionsForName(buildSchemaCatalog(schema), name)[0] ?? null
}

/**
 * 从同名 action 的多个重载中，根据文本内容选择最匹配的重载。
 * 通过检查文本中是否包含某个重载的 keyword 来判断。
 */
export function findBestOverload(name: string, line: string, schema: ActionsSchemaV2): SchemaAction | null {
  return selectActionVariant(buildSchemaCatalog(schema), name, tokenizeLine(line.trim()).slice(1))
}

export function generateKetherText(action: SchemaAction, values: Record<string, unknown>): string {
  const parts: string[] = [action.name]

  // 按 schema inputs 原始顺序输出
  // Kether 规则：
  //   keyword 参数 → 输出标识符（标记型只输出 keyword，前缀型输出 keyword + value）
  //   required 位置参数 → 直接输出值
  //   optional 参数（无 keyword）→ 输出 key 标识符 + value
  for (const input of action.inputs ?? []) {
    const val = values[input.key]

    if (input.keyword) {
      if (val == null) continue
      // 标记型 keyword (type === "keyword")：值是 keyword 的某个部分，只输出一次
      if (input.type === "keyword") {
        const kwParts = keywordAlternatives(input).map((keyword) => keyword.toLowerCase())
        const valLower = String(val).toLowerCase()
        if (kwParts.includes(valLower)) {
          parts.push(String(val))
        } else {
          parts.push(kwParts[0])
        }
      } else {
        // 前缀型 keyword：输出 keyword + value
        if (val === input.default) continue
        const kwParts = keywordAlternatives(input)
        parts.push(kwParts[0] ?? input.keyword)
        parts.push(formatValue(val, input))
      }
    } else if (input.required) {
      // 必填位置参数 → 直接输出值
      const formatted = formatValue(val, input)
      if (formatted !== "") parts.push(formatted)
    } else {
      // 可选参数（无 keyword）→ key 作为标识符 + value
      // 跳过未提供或等于默认值的可选参数
      if (val == null || String(val) === String(input.default ?? "")) continue
      parts.push(input.key)
      parts.push(formatValue(val, input))
    }
  }

  return parts.join(" ")
}

function formatValue(value: unknown, input: SchemaInput): string {
  if (value == null) return String(input.default ?? "")
  const t = input.type.toLowerCase()
  if (t === "string" || t === "text" || t === "container" || t === "selector") {
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
 *
 * Kether 语句解析规则：
 * - 语句以 action name 开头，后面按 schema inputs 顺序依次解析
 * - type="keyword" 且有 keyword 字段 → 固定标识符，必须原样匹配（如 set、ady、level）
 * - 其他 required 参数 → 位置参数，按顺序消费一个表达式
 * - required=false 的可选参数 → 需要先匹配到 key 作为标识符，再消费后面的值
 *   例如 `potion set SLOW 20 level 3` 中 level 是可选参数的标识符，3 是值
 */
export function parseLineValues(line: string, action: SchemaAction, schema?: ActionsSchemaV2): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const tokens = tokenizeLine(line.trim())
  if (tokens.length === 0) return values

  tokens.shift() // skip action name

  // 构建保留全部重载的 action 查找表（用于嵌套表达式消费）
  const actionLookup = new Map<string, SchemaAction[]>()
  if (schema) {
    const add = (name: string, candidate: SchemaAction) => {
      const key = name.toLowerCase()
      const variants = actionLookup.get(key)
      if (variants) variants.push(candidate)
      else actionLookup.set(key, [candidate])
    }
    for (const candidate of schema.actions) {
      add(candidate.name, candidate)
      for (const alias of candidate.aliases) add(alias, candidate)
    }
  }

  const inputs = action.inputs ?? []

  // 第一遍：按 schema inputs 顺序消费 keyword 和 required 位置参数
  let i = 0
  for (const input of inputs) {
    if (i >= tokens.length) break
    if (!input.required) continue // 所有可选参数统一在第二遍按标识符处理

    const tok = tokens[i]
    const lower = tok.toLowerCase()

    if (input.keyword) {
      // 有 keyword 字段的参数 → 必须匹配标识符
      const kwParts = keywordAlternatives(input).map((keyword) => keyword.toLowerCase())
      if (kwParts.includes(lower)) {
        if (input.type === "keyword") {
          values[input.key] = tok
          i++
        } else {
          i++ // consume keyword
          if (i < tokens.length) {
            const { value, nextIndex } = consumeExpression(tokens, i, actionLookup)
            values[input.key] = value
            i = nextIndex
          }
        }
      }
      // keyword 不匹配 → 跳过此参数
      continue
    }

    if (input.required) {
      // 必填位置参数
      // Kether 约定：如果当前 token 恰好等于参数的 key（如 they、source），
      // 则它是前缀标识符，真正的值在下一个 token
      if (lower === input.key.toLowerCase() && i + 1 < tokens.length) {
        i++ // skip key 标识符
      }
      const { value, nextIndex } = consumeExpression(tokens, i, actionLookup)
      values[input.key] = value
      i = nextIndex
    }
  }

  // 第二遍：处理全部可选参数。它们可以按任意顺序出现，不能依赖 Schema 注册顺序。
  const optionalInputs = inputs.filter(inp => !inp.required)
  if (optionalInputs.length > 0) {
    const optKeyMap = new Map<string, SchemaInput>()
    for (const inp of optionalInputs) {
      const markers = inp.keyword ? keywordAlternatives(inp).map((keyword) => keyword.toLowerCase()) : [inp.key.toLowerCase()]
      for (const marker of markers) optKeyMap.set(marker, inp)
    }

    while (i < tokens.length) {
      const tok = tokens[i]
      const optInput = optKeyMap.get(tok.toLowerCase())
      if (!optInput) {
        i++
        continue
      }

      if (optInput.type === "keyword") {
        values[optInput.key] = tok
        i++
        continue
      }

      i++ // consume keyword/key 标识符
      if (i < tokens.length) {
        const { value, nextIndex } = consumeExpression(tokens, i, actionLookup)
        values[optInput.key] = value
        i = nextIndex
      }
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
  actionLookup: Map<string, SchemaAction[]> = new Map()
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

  // 已知 action 名 → 先按后续 keyword 选择稳定重载，再按参数结构递归消费
  const nestedVariants = actionLookup.get(lower) ?? []
  const nestedAction = nestedVariants.length <= 1 ? nestedVariants[0] : [...nestedVariants].sort((left, right) => {
    const remaining = new Set(tokens.slice(startIdx + 1).map((token) => token.toLowerCase()))
    const score = (candidate: SchemaAction) => candidate.inputs.reduce((total, input) => total + (keywordAlternatives(input).some((keyword) => remaining.has(keyword.toLowerCase())) ? 4 : 0), 0)
    return score(right) - score(left) || left.variantId.localeCompare(right.variantId)
  })[0]
  if (nestedAction) {
    const parts: string[] = [tok]
    let idx = startIdx + 1
    const nestedInputs = nestedAction.inputs ?? []

    for (const input of nestedInputs) {
      if (idx >= tokens.length) break
      const curTok = tokens[idx]

      if (input.keyword) {
        const kwParts = keywordAlternatives(input).map((keyword) => keyword.toLowerCase())
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
        // 可选参数：key 作为标识符，匹配到才消费
        if (curTok.toLowerCase() === input.key.toLowerCase()) {
          parts.push(curTok)
          idx++
          if (idx < tokens.length) {
            const inner = consumeExpression(tokens, idx, actionLookup)
            parts.push(inner.value)
            idx = inner.nextIndex
          }
        }
        // key 不匹配 → 此可选参数未提供，跳过
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
