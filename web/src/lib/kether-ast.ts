// Kether AST 解析器 — 对齐 TabooLib SimpleReader / KetherScriptLoader 的游标语义
// 普通 token 仅由空白分隔；列表与块解析器负责消费结构括号。

// ============ AST 节点类型 ============

export interface ASTPosition {
  offset: number
  line: number
  column: number
}

export interface BaseNode {
  type: string
  start: ASTPosition
  end: ASTPosition
}

export interface ScriptNode extends BaseNode {
  type: "script"
  body: ASTNode[]
}

export interface ActionCallNode extends BaseNode {
  type: "action_call"
  name: string
  /** 解析时选中的稳定重载 ID。 */
  variantId: string | null
  args: ASTNode[]
  keywordArgs: Record<string, ASTNode>
}

export interface SetNode extends BaseNode {
  type: "set"
  variable: string
  value: ASTNode
}

export interface IfNode extends BaseNode {
  type: "if"
  condition: ASTNode
  thenBody: ASTNode[]
  elseIfClauses: { condition: ASTNode; body: ASTNode[] }[]
  elseBody: ASTNode[] | null
}

export interface ForNode extends BaseNode {
  type: "for"
  variable: string
  iterable: ASTNode
  body: ASTNode[]
}

export interface CaseNode extends BaseNode {
  type: "case"
  expr: ASTNode
  whenClauses: { operator?: string | null; value: ASTNode; body: ASTNode }[]
  elseClause: ASTNode | null
}

export interface BlockNode extends BaseNode {
  type: "block"
  modifier: "sync" | "async" | null
  body: ASTNode[]
}

export interface ListNode extends BaseNode {
  type: "list"
  items: ASTNode[]
}

export interface CheckNode extends BaseNode {
  type: "check"
  left: ASTNode
  operator: string
  right: ASTNode
}

export interface LogicNode extends BaseNode {
  type: "logic"
  operator: "any" | "all"
  conditions: ASTNode[]
}

export interface MathNode extends BaseNode {
  type: "math"
  operator: string
  operands: ASTNode[]
}

export interface CalcNode extends BaseNode {
  type: "calc"
  formula: string
}

export interface InlineNode extends BaseNode {
  type: "inline"
  template: string
}

export interface LazyNode extends BaseNode {
  type: "lazy"
  expr: ASTNode
}

export interface FlagNode extends BaseNode {
  type: "flag"
  name: ASTNode
  operation: "set" | "remove" | "check"
  value: ASTNode | null
  timeout: ASTNode | null
}

export interface VarRefNode extends BaseNode {
  type: "var_ref"
  name: string
  key: string | null
}

export interface LazyRefNode extends BaseNode {
  type: "lazy_ref"
  name: string
}

export interface SelectorNode extends BaseNode {
  type: "selector"
  selectors: { name: string; negated: boolean; args: ASTNode[] }[]
}

export interface NumberNode extends BaseNode {
  type: "number"
  value: number
}

export interface StringNode extends BaseNode {
  type: "string"
  value: string
}

export interface BooleanNode extends BaseNode {
  type: "boolean"
  value: boolean
}

export interface IdentifierNode extends BaseNode {
  type: "identifier"
  name: string
}

export interface CommentNode extends BaseNode {
  type: "comment"
  text: string
}

export interface ErrorNode extends BaseNode {
  type: "error"
  message: string
  raw: string
}

export interface RawKetherNode extends BaseNode {
  type: "raw"
  raw: string
  reason?: string
}

export type ASTNode =
  | ScriptNode | ActionCallNode | SetNode | IfNode | ForNode
  | CaseNode | BlockNode | ListNode | CheckNode | LogicNode | MathNode
  | CalcNode | InlineNode | LazyNode | FlagNode | VarRefNode
  | LazyRefNode | SelectorNode | NumberNode | StringNode
  | BooleanNode | IdentifierNode | CommentNode | ErrorNode | RawKetherNode

// ============ Schema 类型 ============

export interface ParserSchemaSlot {
  name: string
  label?: string
  multiple?: boolean
  optional?: boolean
  accepts?: string[]
}

export interface SchemaAction {
  id?: string
  variantId?: string
  name: string
  aliases?: string[]
  params: SchemaParam[]
  category?: string
  namespace?: string
  grammar?: Record<string, unknown>
  shape?: string
  flow?: string
  slots?: ParserSchemaSlot[]
}

export interface SchemaParam {
  name: string
  type: string
  keyword?: string
  keywords?: { alternatives: string[]; mode: "flag" | "prefix"; optional?: boolean }
  optional?: boolean
  default?: unknown
  options?: string[]
  accepts?: string[]
}

export interface SchemaSelector {
  id?: string
  name: string
  aliases?: string[]
  params: { name: string; type: string; default?: unknown }[]
}

export interface ActionsSchema {
  actions: SchemaAction[]
  selectors?: SchemaSelector[]
  triggers?: unknown[]
  properties?: unknown[]
}

// ============ KetherReader ============

class KetherParseError extends Error {}
class UnsupportedGrammarError extends KetherParseError {}

interface TokenBlock {
  token: string
  isBlock: boolean
}

class KetherReader {
  private index = 0
  private readonly markStack: number[] = []
  private readonly source: string

  constructor(source: string) {
    this.source = source
  }

  getIndex(): number { return this.index }
  setIndex(index: number) { this.index = Math.max(0, Math.min(index, this.source.length)) }
  checkpoint(): { index: number; marks: number[] } { return { index: this.index, marks: [...this.markStack] } }
  restore(checkpoint: { index: number; marks: number[] }) {
    this.setIndex(checkpoint.index)
    this.markStack.splice(0, this.markStack.length, ...checkpoint.marks)
  }
  getSource(): string { return this.source }

  peek(): string { return this.source[this.index] ?? "" }
  peekAt(offset: number): string { return this.source[this.index + offset] ?? "" }
  skip(count = 1) { this.setIndex(this.index + count) }

  mark() { this.markStack.push(this.index) }
  reset() { this.index = this.markStack.pop() ?? this.index }
  unmark() { this.markStack.pop() }

  skipBlank() {
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (/\s/.test(character)) {
        this.index += 1
        continue
      }
      if (character === "/" && this.source[this.index + 1] === "/") {
        while (this.index < this.source.length && this.source[this.index] !== "\n" && this.source[this.index] !== "\r") {
          this.index += 1
        }
        continue
      }
      // Orryx 历史脚本也使用 # 行注释；只在 token 边界进入 skipBlank 时识别。
      if (character === "#") {
        while (this.index < this.source.length && this.source[this.index] !== "\n" && this.source[this.index] !== "\r") {
          this.index += 1
        }
        continue
      }
      break
    }
  }

  hasNext(): boolean {
    this.skipBlank()
    return this.index < this.source.length
  }

  hasNextOnLine(): boolean {
    let cursor = this.index
    while (cursor < this.source.length) {
      const character = this.source[cursor]
      if (character === "\n" || character === "\r") return false
      if (character === " " || character === "\t" || character === "\f") {
        cursor += 1
        continue
      }
      if (character === "#" || (character === "/" && this.source[cursor + 1] === "/")) return false
      return true
    }
    return false
  }

  getPosition(index = this.index): ASTPosition {
    let line = 1
    let column = 1
    for (let cursor = 0; cursor < index && cursor < this.source.length; cursor += 1) {
      if (this.source[cursor] === "\n") {
        line += 1
        column = 1
      } else {
        column += 1
      }
    }
    return { offset: index, line, column }
  }

  nextToken(): string {
    return this.nextTokenBlock().token
  }

  nextTokenBlock(): TokenBlock {
    this.skipBlank()
    if (this.index >= this.source.length) throw new KetherParseError("意外的文件结束")

    if (this.peek() === '"') {
      let delimiterLength = 0
      while (this.peek() === '"') {
        delimiterLength += 1
        this.index += 1
      }
      const contentStart = this.index
      let matched = 0
      let cursor = this.index
      for (; cursor < this.source.length; cursor += 1) {
        if (this.source[cursor] === '"') {
          matched += 1
        } else if (matched >= delimiterLength) {
          break
        } else {
          matched = 0
        }
      }
      if (matched < delimiterLength) throw new KetherParseError(`字符串缺少 ${delimiterLength} 个双引号闭合符`)
      const token = this.source.slice(contentStart, cursor - delimiterLength).replace(/\\s/g, " ")
      this.index = cursor
      return { token, isBlock: true }
    }

    if (this.peek() === "'") {
      this.index += 1
      const contentStart = this.index
      while (this.index < this.source.length && this.peek() !== "'") this.index += 1
      if (this.index >= this.source.length) throw new KetherParseError("单引号字符串未闭合")
      const token = this.source.slice(contentStart, this.index).replace(/\\s/g, " ")
      this.index += 1
      return { token, isBlock: true }
    }

    const start = this.index
    while (this.index < this.source.length && !/\s/.test(this.source[this.index])) this.index += 1
    return { token: this.source.slice(start, this.index).replace(/\\s/g, " "), isBlock: false }
  }

  expect(value: string): string {
    const actual = this.nextToken()
    if (actual !== value) throw new KetherParseError(`期望 ${value}，实际为 ${actual}`)
    return actual
  }

  expectAny(...values: string[]): string {
    const actual = this.nextToken()
    if (!values.includes(actual)) throw new KetherParseError(`期望 ${values.join(" 或 ")}，实际为 ${actual}`)
    return actual
  }

  tryExpect(value: string): string | null {
    this.mark()
    try {
      const actual = this.expect(value)
      this.unmark()
      return actual
    } catch {
      this.reset()
      return null
    }
  }

  peekToken(): string {
    this.mark()
    try {
      return this.nextToken()
    } catch {
      return ""
    } finally {
      this.reset()
    }
  }

  isStructure(value: "[" | "]" | "{" | "}"): boolean {
    this.skipBlank()
    return this.peek() === value
  }

  consumeStructure(value: "[" | "]" | "{" | "}") {
    this.skipBlank()
    if (this.peek() !== value) throw new KetherParseError(`期望结构符 ${value}，实际为 ${this.peek() || "EOF"}`)
    this.index += 1
  }
}

// ============ KetherParser ============

const CASE_COMPARATORS = new Set([
  "==", "is", "!=", "!is", "not", "=!", "is!", "=!!", "is!!", "=?", "is?",
  ">", "gt", ">=", "gte", "<", "lt", "<=", "lte", "in", "contains", "has",
])

class KetherParser {
  private readonly reader: KetherReader
  private readonly actionMap = new Map<string, SchemaAction[]>()
  private readonly selectorMap = new Map<string, SchemaSelector[]>()

  constructor(source: string, schema?: ActionsSchema) {
    this.reader = new KetherReader(source)
    if (!schema) return

    const addAction = (name: string, action: SchemaAction) => {
      const key = name.toLowerCase()
      const variants = this.actionMap.get(key)
      if (variants) {
        if (!variants.some((candidate) => candidate.id === action.id && candidate.variantId === action.variantId)) variants.push(action)
      } else {
        this.actionMap.set(key, [action])
      }
    }
    const addSelector = (name: string, selector: SchemaSelector) => {
      const key = name.toLowerCase()
      const variants = this.selectorMap.get(key)
      if (variants) variants.push(selector)
      else this.selectorMap.set(key, [selector])
    }

    for (const action of schema.actions) {
      const namespace = action.namespace?.toLowerCase()
      const internalNamespace = namespace?.startsWith("kether_inner") === true
      const names = [action.name, ...(action.aliases ?? [])]
      for (const name of names) {
        if (namespace && !internalNamespace) addAction(`${namespace}:${name}`, action)
        // kether_inner:* 仅由 case 等专用解析器访问，不能污染顶层 action 空间。
        if (!internalNamespace) addAction(name, action)
      }
    }
    for (const selector of schema.selectors ?? []) {
      addSelector(selector.name, selector)
      for (const alias of selector.aliases ?? []) addSelector(alias, selector)
    }
  }

  parse(): ScriptNode {
    const start = this.reader.getPosition()
    const body: ASTNode[] = []

    while (this.reader.hasNext()) {
      const statementStart = this.reader.getIndex()
      try {
        body.push(this.parseStatement())
      } catch (error) {
        this.reader.setIndex(statementStart)
        body.push(this.consumeRawStatement(error instanceof Error ? error.message : "解析失败"))
      }
    }

    return { type: "script", body, start, end: this.reader.getPosition() }
  }

  private parseStatement(): ASTNode {
    this.reader.skipBlank()
    const start = this.reader.getPosition()
    const character = this.reader.peek()

    if (character === "{") return this.parseBlock(null)
    if (character === "[") return this.parseList()
    if (character === "&") return this.parseVarRef()
    if (character === "*") return this.parseLazyRef()
    if (character === '"' || character === "'") return this.parseExpression()
    if (character === "}" || character === "]") throw new KetherParseError(`孤立结构符 ${character}`)

    const token = this.reader.peekToken()
    if (!token) throw new KetherParseError("无法读取 action")
    const lower = token.toLowerCase()

    if (lower === "set") return this.parseSet()
    if (lower === "if") return this.parseIf()
    if (lower === "for") return this.parseFor()
    if (lower === "case") return this.parseCase()
    if (lower === "check") return this.parseCheck()
    if (lower === "all" || lower === "any") return this.parseLogic(lower)
    if (lower === "array" || lower === "arr") return this.parseListAction()
    if (lower === "seq" || lower === "await_all" || lower === "await_any") return this.parseListAction()
    if (lower === "math") return this.parseMath()
    if (lower === "calc") return this.parseCalc()
    if (lower === "inline" || lower === "function") return this.parseInline()
    if (lower === "lazy") return this.parseLazy()
    if (lower === "flag") return this.parseFlag()
    if (lower === "sync" || lower === "async") return this.parseBlock(lower)
    if (lower === "exit" || lower === "stop" || lower === "terminate") {
      const name = this.reader.nextToken()
      return { type: "action_call", name, variantId: this.variantIdFor(name), args: [], keywordArgs: {}, start, end: this.reader.getPosition() }
    }

    if (this.actionMap.has(lower)) return this.parseActionCall()
    return this.consumeRawStatement(`未知 action ${token}`)
  }

  private consumeRawStatement(reason?: string): RawKetherNode {
    const source = this.reader.getSource()
    const startIndex = this.reader.getIndex()
    const structures: string[] = []
    let cursor = startIndex

    while (cursor < source.length) {
      const character = source[cursor]

      if (character === '"') {
        cursor = this.scanDoubleQuoted(source, cursor)
        continue
      }
      if (character === "'") {
        cursor = this.scanSingleQuoted(source, cursor)
        continue
      }

      const previous = cursor === startIndex ? "" : source[cursor - 1]
      const commentBoundary = cursor === startIndex || /\s/.test(previous) || previous === "[" || previous === "{"
      const lineComment = commentBoundary && (
        character === "#" || (character === "/" && source[cursor + 1] === "/")
      )
      if (lineComment) {
        if (structures.length === 0) break
        while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") cursor += 1
        continue
      }

      if ((character === "\n" || character === "\r") && structures.length === 0) break
      if (character === "[") {
        structures.push("]")
        cursor += 1
        continue
      }
      if (character === "{") {
        structures.push("}")
        cursor += 1
        continue
      }
      if (character === "]" || character === "}") {
        const expected = structures[structures.length - 1]
        if (!expected) break
        if (expected === character) structures.pop()
        cursor += 1
        continue
      }
      cursor += 1
    }

    let endIndex = cursor
    while (endIndex > startIndex && /[ \t\r]/.test(source[endIndex - 1])) endIndex -= 1
    if (endIndex === startIndex) endIndex = Math.min(startIndex + 1, source.length)
    this.reader.setIndex(endIndex)

    return {
      type: "raw",
      raw: source.slice(startIndex, endIndex),
      reason,
      start: this.reader.getPosition(startIndex),
      end: this.reader.getPosition(endIndex),
    }
  }

  private scanDoubleQuoted(source: string, start: number): number {
    let delimiterLength = 0
    let cursor = start
    while (source[cursor] === '"') {
      delimiterLength += 1
      cursor += 1
    }
    let matched = 0
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '"') matched += 1
      else if (matched >= delimiterLength) return cursor
      else matched = 0
    }
    return source.length
  }

  private scanSingleQuoted(source: string, start: number): number {
    let cursor = start + 1
    while (cursor < source.length && source[cursor] !== "'") cursor += 1
    return Math.min(cursor + 1, source.length)
  }

  // ---- set VAR to EXPR ----
  private parseSet(): SetNode {
    const start = this.reader.getPosition()
    this.reader.expect("set")
    const variable = this.reader.nextToken()
    this.reader.expect("to")
    const value = this.parseExpression()
    return { type: "set", variable, value, start, end: this.reader.getPosition() }
  }

  // ---- if COND then ACTION [else ACTION] ----
  private parseIf(): IfNode {
    const start = this.reader.getPosition()
    this.reader.expect("if")
    const condition = this.parseExpression()
    this.reader.expect("then")
    const thenBody = this.parseBody()
    const elseIfClauses: IfNode["elseIfClauses"] = []
    let elseBody: ASTNode[] | null = null

    this.reader.mark()
    try {
      this.reader.expect("else")
      const parsedElse = this.parseBody()
      this.reader.unmark()
      if (parsedElse.length === 1 && parsedElse[0]?.type === "if") {
        const nested = parsedElse[0]
        elseIfClauses.push({ condition: nested.condition, body: nested.thenBody }, ...nested.elseIfClauses)
        elseBody = nested.elseBody
      } else {
        elseBody = parsedElse
      }
    } catch {
      this.reader.reset()
    }

    return { type: "if", condition, thenBody, elseIfClauses, elseBody, start, end: this.reader.getPosition() }
  }

  // ---- for VAR in ACTION then ACTION ----
  private parseFor(): ForNode {
    const start = this.reader.getPosition()
    this.reader.expect("for")
    const variable = this.reader.nextToken()
    this.reader.expect("in")
    const iterable = this.parseExpression()
    this.reader.expect("then")
    const body = this.parseBody()
    return { type: "for", variable, iterable, body, start, end: this.reader.getPosition() }
  }

  // ---- case ACTION [ when [OP] ACTION then/-> ACTION ... else ACTION ] ----
  private parseCase(): CaseNode {
    const start = this.reader.getPosition()
    this.reader.expect("case")
    const expr = this.parseExpression()
    this.reader.consumeStructure("[")
    const whenClauses: CaseNode["whenClauses"] = []
    let elseClause: ASTNode | null = null

    while (this.reader.hasNext() && !this.reader.isStructure("]")) {
      const keyword = this.reader.peekToken()
      if (keyword === "when") {
        this.reader.expect("when")
        let operator: string | null = null
        this.reader.mark()
        const possibleOperator = this.reader.nextToken()
        if (CASE_COMPARATORS.has(possibleOperator)) {
          operator = possibleOperator
          this.reader.unmark()
        } else {
          this.reader.reset()
        }
        const value = this.reader.isStructure("[") ? this.parseList() : this.parseExpression()
        this.reader.expectAny("then", "->")
        const body = this.parseExpression()
        whenClauses.push({ operator, value, body })
        continue
      }
      if (keyword === "else") {
        if (elseClause) throw new KetherParseError("case 只能包含一个 else")
        this.reader.expect("else")
        elseClause = this.parseExpression()
        continue
      }
      throw new KetherParseError(`case 中只允许 when/else，实际为 ${keyword}`)
    }

    this.reader.consumeStructure("]")
    return { type: "case", expr, whenClauses, elseClause, start, end: this.reader.getPosition() }
  }

  // ---- { } / sync { } / async { } ----
  private parseBlock(modifier: "sync" | "async" | null): BlockNode {
    const start = this.reader.getPosition()
    if (modifier) this.reader.expect(modifier)
    this.reader.consumeStructure("{")
    const body: ASTNode[] = []
    while (this.reader.hasNext() && !this.reader.isStructure("}")) body.push(this.parseStatement())
    this.reader.consumeStructure("}")
    return { type: "block", modifier, body, start, end: this.reader.getPosition() }
  }

  // ---- [ ACTION... ] ----
  private parseList(): ListNode {
    const start = this.reader.getPosition()
    this.reader.consumeStructure("[")
    const items: ASTNode[] = []
    while (this.reader.hasNext() && !this.reader.isStructure("]")) items.push(this.parseExpression())
    this.reader.consumeStructure("]")
    return { type: "list", items, start, end: this.reader.getPosition() }
  }

  // ---- array/seq/await_* [ ACTION... ] ----
  private parseListAction(): ActionCallNode {
    const start = this.reader.getPosition()
    const name = this.reader.nextToken()
    const list = this.parseList()
    return {
      type: "action_call",
      name,
      variantId: this.variantIdFor(name),
      args: [list],
      keywordArgs: {},
      start,
      end: this.reader.getPosition(),
    }
  }

  // ---- flag NAME to/remove/set ----
  private parseFlag(): FlagNode {
    const start = this.reader.getPosition()
    this.reader.expect("flag")
    const name = this.parseExpression()
    let operation: FlagNode["operation"] = "check"
    let value: ASTNode | null = null
    let timeout: ASTNode | null = null

    this.reader.mark()
    try {
      const token = this.reader.nextToken()
      if (token === "to" || token === "set") {
        operation = "set"
        value = this.parseExpression()
        if (this.reader.tryExpect("timeout")) timeout = this.parseExpression()
        this.reader.unmark()
      } else if (token === "remove") {
        operation = "remove"
        this.reader.unmark()
      } else {
        this.reader.reset()
      }
    } catch {
      this.reader.reset()
    }

    return { type: "flag", name, operation, value, timeout, start, end: this.reader.getPosition() }
  }

  // ---- check ACTION OP ACTION ----
  private parseCheck(): CheckNode {
    const start = this.reader.getPosition()
    this.reader.expect("check")
    const left = this.parseExpression()
    const operator = this.reader.nextToken()
    const right = this.parseExpression()
    return { type: "check", left, operator, right, start, end: this.reader.getPosition() }
  }

  // ---- any/all [ ACTION... ] ----
  private parseLogic(operator: "any" | "all"): LogicNode {
    const start = this.reader.getPosition()
    this.reader.expect(operator)
    const list = this.parseList()
    return { type: "logic", operator, conditions: list.items, start, end: this.reader.getPosition() }
  }

  // ---- math OP [ ACTION... ] ----
  private parseMath(): MathNode {
    const start = this.reader.getPosition()
    this.reader.expect("math")
    const operator = this.reader.nextToken()
    const list = this.parseList()
    return { type: "math", operator, operands: list.items, start, end: this.reader.getPosition() }
  }

  private parseCalc(): CalcNode {
    const start = this.reader.getPosition()
    this.reader.expect("calc")
    const formula = this.reader.nextTokenBlock().token
    return { type: "calc", formula, start, end: this.reader.getPosition() }
  }

  private parseInline(): InlineNode {
    const start = this.reader.getPosition()
    this.reader.nextToken()
    const template = this.reader.nextTokenBlock().token
    return { type: "inline", template, start, end: this.reader.getPosition() }
  }

  private parseLazy(): LazyNode {
    const start = this.reader.getPosition()
    this.reader.expect("lazy")
    const expr = this.parseExpression()
    return { type: "lazy", expr, start, end: this.reader.getPosition() }
  }

  // ---- &VAR / &VAR[key] ----
  private parseVarRef(): VarRefNode {
    const start = this.reader.getPosition()
    const token = this.reader.nextToken()
    const value = token.startsWith("&") ? token.slice(1) : token
    const bracketIndex = value.indexOf("[")
    if (bracketIndex > 0 && value.endsWith("]")) {
      return {
        type: "var_ref",
        name: value.slice(0, bracketIndex),
        key: value.slice(bracketIndex + 1, -1),
        start,
        end: this.reader.getPosition(),
      }
    }
    return { type: "var_ref", name: value, key: null, start, end: this.reader.getPosition() }
  }

  private parseLazyRef(): LazyRefNode {
    const start = this.reader.getPosition()
    const token = this.reader.nextToken()
    return { type: "lazy_ref", name: token.startsWith("*") ? token.slice(1) : token, start, end: this.reader.getPosition() }
  }

  private keywordAlternatives(param: SchemaParam): string[] {
    return param.keywords?.alternatives ?? (param.keyword ? param.keyword.split("/").filter(Boolean) : [])
  }

  private actionCandidates(name: string): SchemaAction[] {
    return this.actionMap.get(name.toLowerCase()) ?? []
  }

  /** hardcoded TabooLib action 只需要稳定 variantId，仍优先选择声明更完整的候选。 */
  private selectActionVariant(name: string): SchemaAction | undefined {
    return [...this.actionCandidates(name)].sort((left, right) => {
      const score = (action: SchemaAction) => action.params.filter((param) => !param.optional).length * 4
        + (Array.isArray(action.grammar?.sequence) ? 2 : 0)
        - (action.grammar?.localRawRemainder === true ? 4 : 0)
      return score(right) - score(left) || String(left.variantId ?? left.id ?? "").localeCompare(String(right.variantId ?? right.id ?? ""))
    })[0]
  }

  private variantIdFor(name: string): string | null {
    const action = this.selectActionVariant(name)
    return action?.variantId ?? action?.id ?? null
  }

  private parseActionCandidate(action: SchemaAction, consumedName: string): { args: ASTNode[]; keywordArgs: Record<string, ASTNode> } {
    const args: ASTNode[] = []
    const keywordArgs: Record<string, ASTNode> = {}
    const grammar = action.grammar ?? {}
    if (grammar.localRawRemainder === true) throw new UnsupportedGrammarError(`${consumedName} 使用 localRawRemainder`)
    if (Array.isArray(grammar.sequence)) this.parseGrammarSequence(grammar.sequence, action, consumedName, args)
    else this.parseSchemaParams(action.params, args, keywordArgs)
    return { args, keywordArgs }
  }

  // ---- Action 调用：对每个同名候选实际试解析，成功后按消费范围与声明完整度选择。 ----
  private parseActionCall(): ActionCallNode {
    const start = this.reader.getPosition()
    const name = this.reader.nextToken()
    const candidates = this.actionCandidates(name)
    if (candidates.length === 0) throw new UnsupportedGrammarError(`未知 action ${name}`)

    const argumentStart = this.reader.checkpoint()
    const attempts: Array<{
      action: SchemaAction
      args: ASTNode[]
      keywordArgs: Record<string, ASTNode>
      end: number
    }> = []
    let firstError: unknown = null

    for (const action of candidates) {
      this.reader.restore(argumentStart)
      try {
        const parsed = this.parseActionCandidate(action, name)
        attempts.push({ action, ...parsed, end: this.reader.getIndex() })
      } catch (error) {
        firstError ??= error
      }
    }

    if (attempts.length === 0) {
      this.reader.restore(argumentStart)
      throw firstError instanceof Error ? firstError : new UnsupportedGrammarError(`${name} 没有可匹配的 grammar`)
    }

    const confidence = (action: SchemaAction) => action.params.filter((param) => !param.optional).length * 4
      + (Array.isArray(action.grammar?.sequence) ? 2 : 0)
      - (action.grammar?.localRawRemainder === true ? 4 : 0)
    attempts.sort((left, right) => (
      right.end - left.end
      || confidence(right.action) - confidence(left.action)
      || String(left.action.variantId ?? left.action.id ?? "").localeCompare(String(right.action.variantId ?? right.action.id ?? ""))
    ))
    const selected = attempts[0]
    this.reader.restore({ index: selected.end, marks: argumentStart.marks })

    return {
      type: "action_call",
      name,
      variantId: selected.action.variantId ?? selected.action.id ?? null,
      args: selected.args,
      keywordArgs: selected.keywordArgs,
      start,
      end: this.reader.getPosition(),
    }
  }

  private parseGrammarSequence(sequence: unknown[], action: SchemaAction, consumedName: string, args: ASTNode[]) {
    sequence.forEach((item, index) => {
      if (index === 0 && typeof item === "string") {
        const actionNames = new Set([action.name, ...(action.aliases ?? []), consumedName].map((name) => name.toLowerCase()))
        if (actionNames.has(item.toLowerCase()) || item.toLowerCase() === action.name.toLowerCase()) return
      }
      this.parseGrammarItem(item, action, args)
    })
  }

  private parseGrammarItem(item: unknown, action: SchemaAction, args: ASTNode[]) {
    if (typeof item === "string") {
      const start = this.reader.getPosition()
      const actual = this.reader.expect(item)
      args.push({ type: "identifier", name: actual, start, end: this.reader.getPosition() })
      return
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UnsupportedGrammarError(`${action.name} 包含无法识别的 grammar.sequence 项`)
    }

    const descriptor = item as Record<string, unknown>
    if (Array.isArray(descriptor.optional)) {
      const argsLength = args.length
      this.reader.mark()
      try {
        for (const optionalItem of descriptor.optional) this.parseGrammarItem(optionalItem, action, args)
        this.reader.unmark()
      } catch {
        this.reader.reset()
        args.splice(argsLength)
      }
      return
    }
    if (typeof descriptor.actionList === "string" || typeof descriptor.list === "string") {
      args.push(this.parseList())
      return
    }
    if (descriptor.localRawRemainder === true || descriptor.operatorCatalog || descriptor.caseArms) {
      throw new UnsupportedGrammarError(`${action.name} 的 grammar 需要局部 raw 保真`)
    }
    if (typeof descriptor.input === "string" || typeof descriptor.branch === "string") {
      args.push(this.parseExpression())
      return
    }
    if (typeof descriptor.literal === "string" || typeof descriptor.localRaw === "string") {
      args.push(this.parseAtomic())
      return
    }
    throw new UnsupportedGrammarError(`${action.name} 包含未支持的 grammar 描述符`)
  }

  private parseSchemaParams(params: SchemaParam[], args: ASTNode[], keywordArgs: Record<string, ASTNode>) {
    for (const param of params) {
      const alternatives = this.keywordAlternatives(param)
      if (alternatives.length > 0) {
        this.reader.mark()
        try {
          const actualKeyword = this.reader.expectAny(...alternatives)
          if (param.type.toLowerCase() === "keyword" || param.keywords?.mode === "flag") {
            const position = this.reader.getPosition()
            keywordArgs[actualKeyword] = { type: "identifier", name: actualKeyword, start: position, end: position }
          } else {
            keywordArgs[actualKeyword] = this.parseParamValue(param)
          }
          this.reader.unmark()
        } catch (error) {
          this.reader.reset()
          if (!param.optional) throw error
        }
        continue
      }

      if (param.optional && !this.reader.hasNextOnLine()) continue
      args.push(this.parseParamValue(param))
    }
  }

  private parseParamValue(param: SchemaParam): ASTNode {
    const type = param.type.toLowerCase()
    if (type === "keyword" || type === "enum" || type === "raw") return this.parseAtomic()
    return this.parseExpression()
  }

  // ---- 表达式解析：对应 QuestReader.nextAction() ----
  private parseExpression(): ASTNode {
    if (!this.reader.hasNext()) throw new KetherParseError("意外的文件结束")
    const character = this.reader.peek()

    if (character === "{") return this.parseBlock(null)
    if (character === "[") return this.parseList()
    if (character === "&") return this.parseVarRef()
    if (character === "*") return this.parseLazyRef()
    if (character === '"' || character === "'") {
      const start = this.reader.getPosition()
      const token = this.reader.nextTokenBlock().token
      return { type: "string", value: token, start, end: this.reader.getPosition() }
    }

    const start = this.reader.getPosition()
    this.reader.mark()
    const token = this.reader.nextToken()
    const lower = token.toLowerCase()

    if (lower === "true" || lower === "false") {
      this.reader.unmark()
      return { type: "boolean", value: lower === "true", start, end: this.reader.getPosition() }
    }
    if (/^-?\d+(?:\.\d+)?$/.test(token)) {
      this.reader.unmark()
      return { type: "number", value: Number(token), start, end: this.reader.getPosition() }
    }

    if (lower === "set") { this.reader.reset(); return this.parseSet() }
    if (lower === "if") { this.reader.reset(); return this.parseIf() }
    if (lower === "for") { this.reader.reset(); return this.parseFor() }
    if (lower === "case") { this.reader.reset(); return this.parseCase() }
    if (lower === "check") { this.reader.reset(); return this.parseCheck() }
    if (lower === "all" || lower === "any") { this.reader.reset(); return this.parseLogic(lower) }
    if (lower === "array" || lower === "arr" || lower === "seq" || lower === "await_all" || lower === "await_any") {
      this.reader.reset()
      return this.parseListAction()
    }
    if (lower === "math") { this.reader.reset(); return this.parseMath() }
    if (lower === "calc") { this.reader.reset(); return this.parseCalc() }
    if (lower === "inline" || lower === "function") { this.reader.reset(); return this.parseInline() }
    if (lower === "lazy") { this.reader.reset(); return this.parseLazy() }
    if (lower === "flag") { this.reader.reset(); return this.parseFlag() }
    if (lower === "sync" || lower === "async") { this.reader.reset(); return this.parseBlock(lower) }
    if (lower === "exit" || lower === "stop" || lower === "terminate") {
      this.reader.unmark()
      return { type: "action_call", name: token, variantId: this.variantIdFor(token), args: [], keywordArgs: {}, start, end: this.reader.getPosition() }
    }
    if (this.actionMap.has(lower)) {
      this.reader.reset()
      return this.parseActionCall()
    }

    this.reader.unmark()
    return { type: "identifier", name: token, start, end: this.reader.getPosition() }
  }

  private parseAtomic(): ASTNode {
    if (!this.reader.hasNext()) throw new KetherParseError("意外的文件结束")
    const start = this.reader.getPosition()
    const character = this.reader.peek()
    if (character === "[") return this.parseList()
    if (character === "&") return this.parseVarRef()
    if (character === "*") return this.parseLazyRef()
    if (character === '"' || character === "'") {
      const token = this.reader.nextTokenBlock().token
      return { type: "string", value: token, start, end: this.reader.getPosition() }
    }
    const token = this.reader.nextToken()
    const lower = token.toLowerCase()
    if (lower === "true" || lower === "false") return { type: "boolean", value: lower === "true", start, end: this.reader.getPosition() }
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return { type: "number", value: Number(token), start, end: this.reader.getPosition() }
    return { type: "identifier", name: token, start, end: this.reader.getPosition() }
  }

  private parseBody(): ASTNode[] {
    if (!this.reader.hasNext()) throw new KetherParseError("缺少 action body")
    if (this.reader.isStructure("{")) return this.parseBlock(null).body
    return [this.parseStatement()]
  }
}

// ============ AST → 文本 ============

class KetherStringifier {
  private indent = 0

  stringify(node: ScriptNode): string {
    return node.body.map((child) => this.node(child, true)).join("\n")
  }

  stringifyOne(node: ASTNode): string {
    return this.node(node, false)
  }

  private pad(): string { return "  ".repeat(this.indent) }
  private token(value: string): string { return value.replace(/\s/g, "\\s") }

  private quoted(value: string): string {
    if (value.length === 0) return "''"
    if (!value.includes('"')) return `"${value}"`
    if (!value.includes("'")) return `'${value}'`
    const longestRun = Math.max(0, ...Array.from(value.matchAll(/"+/g), (match) => match[0].length))
    const delimiter = '"'.repeat(longestRun + 1)
    return `${delimiter}${value}${delimiter}`
  }

  private node(node: ASTNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    switch (node.type) {
      case "script": return node.body.map((child) => this.node(child, true)).join("\n")
      case "action_call": return this.actionCall(node, statement)
      case "set": return `${prefix}set ${this.token(node.variable)} to ${this.node(node.value, false)}`
      case "if": return this.ifNode(node, statement)
      case "for": return this.forNode(node, statement)
      case "case": return this.caseNode(node, statement)
      case "block": return this.blockNode(node, statement)
      case "list": return `[ ${node.items.map((item) => this.node(item, false)).join(" ")} ]`
      case "flag": return this.flagNode(node, statement)
      case "check": return `${prefix}check ${this.node(node.left, false)} ${this.token(node.operator)} ${this.node(node.right, false)}`
      case "logic": return `${prefix}${node.operator} [ ${node.conditions.map((condition) => this.node(condition, false)).join(" ")} ]`
      case "math": return `${prefix}math ${this.token(node.operator)} [ ${node.operands.map((operand) => this.node(operand, false)).join(" ")} ]`
      case "calc": return `${prefix}calc ${this.quoted(node.formula)}`
      case "inline": return `${prefix}inline ${this.quoted(node.template)}`
      case "lazy": return `${prefix}lazy ${this.node(node.expr, false)}`
      case "var_ref": return `&${this.token(node.name)}${node.key === null ? "" : `[${this.token(node.key)}]`}`
      case "lazy_ref": return `*${this.token(node.name)}`
      case "selector": return this.selectorNode(node)
      case "number": return String(node.value)
      case "string": return this.quoted(node.value)
      case "boolean": return String(node.value)
      case "identifier": return this.token(node.name)
      case "comment": return `${prefix}# ${node.text}`
      case "error": return node.raw
      case "raw": return node.raw
    }
  }

  private actionCall(node: ActionCallNode, statement: boolean): string {
    const parts = [(statement ? this.pad() : "") + node.name]
    for (const argument of node.args) parts.push(this.node(argument, false))
    for (const [keyword, value] of Object.entries(node.keywordArgs)) {
      parts.push(this.token(keyword))
      const keywordOnly = value.type === "identifier" && value.name === keyword
      if (!keywordOnly) parts.push(this.node(value, false))
    }
    return parts.join(" ")
  }

  private ifNode(node: IfNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    let result = `${prefix}if ${this.node(node.condition, false)} then {\n`
    this.indent += 1
    result += node.thenBody.map((child) => this.node(child, true)).join("\n")
    this.indent -= 1
    result += `\n${this.pad()}}`
    for (const clause of node.elseIfClauses) {
      result += ` else if ${this.node(clause.condition, false)} then {\n`
      this.indent += 1
      result += clause.body.map((child) => this.node(child, true)).join("\n")
      this.indent -= 1
      result += `\n${this.pad()}}`
    }
    if (node.elseBody) {
      result += " else {\n"
      this.indent += 1
      result += node.elseBody.map((child) => this.node(child, true)).join("\n")
      this.indent -= 1
      result += `\n${this.pad()}}`
    }
    return result
  }

  private forNode(node: ForNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    let result = `${prefix}for ${this.token(node.variable)} in ${this.node(node.iterable, false)} then {\n`
    this.indent += 1
    result += node.body.map((child) => this.node(child, true)).join("\n")
    this.indent -= 1
    return `${result}\n${this.pad()}}`
  }

  private caseNode(node: CaseNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    let result = `${prefix}case ${this.node(node.expr, false)} [\n`
    this.indent += 1
    for (const clause of node.whenClauses) {
      const operator = clause.operator ? `${this.token(clause.operator)} ` : ""
      result += `${this.pad()}when ${operator}${this.node(clause.value, false)} -> ${this.node(clause.body, false)}\n`
    }
    if (node.elseClause) result += `${this.pad()}else ${this.node(node.elseClause, false)}\n`
    this.indent -= 1
    return `${result}${this.pad()}]`
  }

  private blockNode(node: BlockNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    const modifier = node.modifier ? `${node.modifier} ` : ""
    let result = `${prefix}${modifier}{\n`
    this.indent += 1
    result += node.body.map((child) => this.node(child, true)).join("\n")
    this.indent -= 1
    return `${result}\n${this.pad()}}`
  }

  private flagNode(node: FlagNode, statement: boolean): string {
    const prefix = statement ? this.pad() : ""
    let result = `${prefix}flag ${this.node(node.name, false)}`
    if (node.operation === "set" && node.value) result += ` to ${this.node(node.value, false)}`
    else if (node.operation === "remove") result += " remove"
    if (node.timeout) result += ` timeout ${this.node(node.timeout, false)}`
    return result
  }

  private selectorNode(node: SelectorNode): string {
    const parts = node.selectors.map((selector) => {
      const prefix = selector.negated ? "!@" : "@"
      const args = selector.args.map((argument) => this.node(argument, false)).join(" ")
      return args ? `${prefix}${selector.name} ${args}` : `${prefix}${selector.name}`
    })
    return this.quoted(parts.join(" "))
  }
}

// ============ 导出 ============

export function parseKether(source: string, schema?: ActionsSchema): ScriptNode {
  return new KetherParser(source, schema).parse()
}

export function stringifyKether(ast: ScriptNode): string {
  return new KetherStringifier().stringify(ast)
}

/** 将单个 AST 节点序列化为文本 */
export function stringifyNode(node: ASTNode): string {
  return new KetherStringifier().stringifyOne(node)
}
