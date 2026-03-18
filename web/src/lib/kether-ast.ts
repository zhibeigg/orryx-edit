// Kether AST 解析器 — 模拟 TabooLib 的 SimpleReader 解析机制
// 基于 actions-schema.json 驱动 action 参数解析

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
  whenClauses: { value: ASTNode; body: ASTNode }[]
  elseClause: ASTNode | null
}

export interface BlockNode extends BaseNode {
  type: "block"
  modifier: "sync" | "async" | null
  body: ASTNode[]
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

export type ASTNode =
  | ScriptNode | ActionCallNode | SetNode | IfNode | ForNode
  | CaseNode | BlockNode | CheckNode | LogicNode | MathNode
  | CalcNode | InlineNode | LazyNode | FlagNode | VarRefNode
  | LazyRefNode | SelectorNode | NumberNode | StringNode
  | BooleanNode | IdentifierNode | CommentNode | ErrorNode

// ============ Schema 类型 ============

export interface SchemaAction {
  name: string
  aliases?: string[]
  params: SchemaParam[]
  category?: string
}

export interface SchemaParam {
  name: string
  type: string
  keyword?: string
  optional?: boolean
  default?: unknown
  options?: string[]
}

export interface SchemaSelector {
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

class KetherReader {
  private source: string
  private index = 0
  private markStack: number[] = []

  constructor(source: string) {
    this.source = source
  }

  getIndex(): number { return this.index }
  setIndex(i: number) { this.index = i }
  getSource(): string { return this.source }

  peek(): string { return this.source[this.index] ?? "" }
  peekAt(n: number): string { return this.source[this.index + n] ?? "" }

  hasNext(): boolean {
    this.skipBlank()
    return this.index < this.source.length
  }

  mark() { this.markStack.push(this.index) }
  reset() { this.index = this.markStack.pop() ?? 0 }
  unmark() { this.markStack.pop() }

  skip(n = 1) { this.index += n }

  skipBlank() {
    while (this.index < this.source.length) {
      const ch = this.source[this.index]
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.index++
      } else if (ch === "\n") {
        this.index++
      } else if (ch === "#") {
        // 跳过行注释
        while (this.index < this.source.length && this.source[this.index] !== "\n") {
          this.index++
        }
      } else if (ch === "/" && this.peekAt(1) === "/") {
        // 跳过 // 注释
        while (this.index < this.source.length && this.source[this.index] !== "\n") {
          this.index++
        }
      } else {
        break
      }
    }
  }

  getPosition(): ASTPosition {
    let line = 1, column = 1
    for (let i = 0; i < this.index && i < this.source.length; i++) {
      if (this.source[i] === "\n") { line++; column = 1 }
      else { column++ }
    }
    return { offset: this.index, line, column }
  }

  nextToken(): string {
    this.skipBlank()
    if (this.index >= this.source.length) return ""
    const start = this.index
    while (this.index < this.source.length) {
      const ch = this.source[this.index]
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") break
      // 特殊单字符 token
      if (ch === "{" || ch === "}" || ch === "[" || ch === "]") {
        if (this.index === start) { this.index++; return ch }
        break
      }
      this.index++
    }
    return this.source.slice(start, this.index)
  }

  nextTokenBlock(): { token: string; isBlock: boolean } {
    this.skipBlank()
    if (this.index >= this.source.length) return { token: "", isBlock: false }
    const ch = this.source[this.index]

    // 双引号字符串
    if (ch === '"') {
      this.index++
      let result = ""
      let escaped = false
      while (this.index < this.source.length) {
        const c = this.source[this.index]
        if (escaped) { result += c; escaped = false }
        else if (c === "\\") { escaped = true; result += c }
        else if (c === '"') { this.index++; break }
        else { result += c }
        this.index++
      }
      return { token: result, isBlock: true }
    }

    // 单引号字符串
    if (ch === "'") {
      this.index++
      let result = ""
      while (this.index < this.source.length && this.source[this.index] !== "'") {
        result += this.source[this.index]
        this.index++
      }
      if (this.index < this.source.length) this.index++ // skip closing '
      return { token: result, isBlock: true }
    }

    return { token: this.nextToken(), isBlock: false }
  }

  expect(value: string): boolean {
    this.skipBlank()
    this.mark()
    const token = this.nextToken()
    if (token.toLowerCase() === value.toLowerCase()) {
      this.unmark()
      return true
    }
    this.reset()
    return false
  }

  peekToken(): string {
    this.mark()
    const token = this.nextToken()
    this.reset()
    return token
  }

  peekTokenBlock(): { token: string; isBlock: boolean } {
    this.mark()
    const tb = this.nextTokenBlock()
    this.reset()
    return tb
  }
}

// ============ KetherParser ============

// 内置关键字（Kether 核心语法，不在 schema 中）
const BUILTIN_KEYWORDS = new Set([
  "set", "if", "else", "then", "for", "in", "range", "to",
  "case", "when", "check", "any", "all", "math", "calc",
  "inline", "lazy", "flag", "sync", "async", "exit",
  "def", "true", "false", "not"
])

const COMPARATORS = ["==", "!=", ">", ">=", "<", "<="] as const
export type Comparator = typeof COMPARATORS[number]

class KetherParser {
  private reader: KetherReader
  private _schema: ActionsSchema | undefined

  private actionMap: Map<string, SchemaAction> = new Map()
  private selectorMap: Map<string, SchemaSelector> = new Map()

  constructor(source: string, schema?: ActionsSchema) {
    this.reader = new KetherReader(source)
    this._schema = schema
    void this._schema // used via actionMap/selectorMap
    if (schema) {
      for (const a of schema.actions) {
        this.actionMap.set(a.name.toLowerCase(), a)
        for (const alias of a.aliases ?? []) {
          this.actionMap.set(alias.toLowerCase(), a)
        }
      }
      for (const s of schema.selectors ?? []) {
        this.selectorMap.set(s.name.toLowerCase(), s)
        for (const alias of s.aliases ?? []) {
          this.selectorMap.set(alias.toLowerCase(), s)
        }
      }
    }
  }

  parse(): ScriptNode {
    const start = this.reader.getPosition()
    const body: ASTNode[] = []
    while (this.reader.hasNext()) {
      try {
        const node = this.parseStatement()
        if (node) body.push(node)
      } catch {
        // 错误恢复：跳到下一行
        const errStart = this.reader.getPosition()
        const raw = this.skipToNextLine()
        body.push({
          type: "error", message: "解析错误", raw,
          start: errStart, end: this.reader.getPosition()
        })
      }
    }
    return { type: "script", body, start, end: this.reader.getPosition() }
  }

  private skipToNextLine(): string {
    const start = this.reader.getIndex()
    const src = this.reader.getSource()
    while (this.reader.getIndex() < src.length && src[this.reader.getIndex()] !== "\n") {
      this.reader.skip()
    }
    return src.slice(start, this.reader.getIndex())
  }

  private parseStatement(): ASTNode | null {
    if (!this.reader.hasNext()) return null
    const start = this.reader.getPosition()
    const token = this.reader.peekToken()
    if (!token) return null

    const lower = token.toLowerCase()

    // 内置语法分派
    if (lower === "set") return this.parseSet()
    if (lower === "if") return this.parseIf()
    if (lower === "for") return this.parseFor()
    if (lower === "case") return this.parseCase()
    if (lower === "sync" || lower === "async") return this.parseBlock(lower as "sync" | "async")
    if (lower === "flag") return this.parseFlag()
    if (lower === "check") return this.parseCheck()
    if (lower === "any" || lower === "all") return this.parseLogic(lower as "any" | "all")
    if (lower === "math") return this.parseMath()
    if (lower === "calc") return this.parseCalc()
    if (lower === "inline") return this.parseInline()
    if (lower === "lazy") return this.parseLazy()
    if (lower === "exit") { this.reader.nextToken(); return { type: "action_call", name: "exit", args: [], keywordArgs: {}, start, end: this.reader.getPosition() } }

    // { } 匿名块
    if (token === "{") return this.parseBlock(null)

    // 前缀分派
    const ch = this.reader.peek()
    if (ch === "&") return this.parseVarRef()
    if (ch === "*") return this.parseLazyRef()

    // Action 调用（从 schema 查找）
    return this.parseActionCall()
  }

  // ---- set VAR to EXPR ----
  private parseSet(): SetNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "set"
    const variable = this.reader.nextToken()
    this.reader.expect("to")
    const value = this.parseExpression()
    return { type: "set", variable, value, start, end: this.reader.getPosition() }
  }

  // ---- if COND then BODY [else if ... else ...] ----
  private parseIf(): IfNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "if"
    const condition = this.parseExpression()
    this.reader.expect("then")
    const thenBody = this.parseBody()
    const elseIfClauses: { condition: ASTNode; body: ASTNode[] }[] = []
    let elseBody: ASTNode[] | null = null

    while (this.reader.hasNext()) {
      this.reader.mark()
      const next = this.reader.peekToken()
      if (next.toLowerCase() === "else") {
        this.reader.nextToken() // consume "else"
        const afterElse = this.reader.peekToken()
        if (afterElse.toLowerCase() === "if") {
          this.reader.unmark()
          this.reader.nextToken() // consume "if"
          const cond = this.parseExpression()
          this.reader.expect("then")
          const body = this.parseBody()
          elseIfClauses.push({ condition: cond, body })
        } else {
          this.reader.unmark()
          elseBody = this.parseBody()
          break
        }
      } else {
        this.reader.reset()
        break
      }
    }
    return { type: "if", condition, thenBody, elseIfClauses, elseBody, start, end: this.reader.getPosition() }
  }

  // ---- for VAR in ITERABLE then BODY ----
  private parseFor(): ForNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "for"
    const variable = this.reader.nextToken()
    this.reader.expect("in")
    const iterable = this.parseExpression()
    this.reader.expect("then")
    const body = this.parseBody()
    return { type: "for", variable, iterable, body, start, end: this.reader.getPosition() }
  }

  // ---- case EXPR [ when VAL -> BODY ... ] ----
  private parseCase(): CaseNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "case"
    const expr = this.parseExpression()
    this.reader.expect("[")
    const whenClauses: { value: ASTNode; body: ASTNode }[] = []
    let elseClause: ASTNode | null = null

    while (this.reader.hasNext() && this.reader.peekToken() !== "]") {
      const kw = this.reader.peekToken().toLowerCase()
      if (kw === "when") {
        this.reader.nextToken() // consume "when"
        const value = this.parseExpression()
        this.reader.expect("->")
        const body = this.parseExpression()
        whenClauses.push({ value, body })
      } else if (kw === "else") {
        this.reader.nextToken() // consume "else"
        elseClause = this.parseExpression()
      } else {
        break
      }
    }
    this.reader.expect("]")
    return { type: "case", expr, whenClauses, elseClause, start, end: this.reader.getPosition() }
  }

  // ---- { } / sync { } / async { } ----
  private parseBlock(modifier: "sync" | "async" | null): BlockNode {
    const start = this.reader.getPosition()
    if (modifier) this.reader.nextToken() // consume sync/async
    this.reader.expect("{")
    const body: ASTNode[] = []
    while (this.reader.hasNext() && this.reader.peekToken() !== "}") {
      const stmt = this.parseStatement()
      if (stmt) body.push(stmt)
    }
    this.reader.expect("}")
    return { type: "block", modifier, body, start, end: this.reader.getPosition() }
  }

  // ---- flag NAME to/remove/set ----
  private parseFlag(): FlagNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "flag"
    const name = this.parseExpression()
    let operation: "set" | "remove" | "check" = "check"
    let value: ASTNode | null = null
    let timeout: ASTNode | null = null

    this.reader.mark()
    const next = this.reader.peekToken().toLowerCase()
    if (next === "to" || next === "set") {
      this.reader.unmark()
      this.reader.nextToken()
      operation = "set"
      value = this.parseExpression()
      if (this.reader.hasNext() && this.reader.peekToken().toLowerCase() === "timeout") {
        this.reader.nextToken()
        timeout = this.parseExpression()
      }
    } else if (next === "remove") {
      this.reader.unmark()
      this.reader.nextToken()
      operation = "remove"
    } else {
      this.reader.reset()
    }
    return { type: "flag", name, operation, value, timeout, start, end: this.reader.getPosition() }
  }

  // ---- check EXPR OP EXPR ----
  private parseCheck(): CheckNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "check"
    const left = this.parseExpression()
    const op = this.reader.nextToken()
    const right = this.parseExpression()
    return { type: "check", left, operator: op, right, start, end: this.reader.getPosition() }
  }

  // ---- any/all [ ... ] ----
  private parseLogic(op: "any" | "all"): LogicNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume any/all
    this.reader.expect("[")
    const conditions: ASTNode[] = []
    while (this.reader.hasNext() && this.reader.peekToken() !== "]") {
      conditions.push(this.parseExpression())
    }
    this.reader.expect("]")
    return { type: "logic", operator: op, conditions, start, end: this.reader.getPosition() }
  }

  // ---- math OP [ ... ] ----
  private parseMath(): MathNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "math"
    const operator = this.reader.nextToken()
    this.reader.expect("[")
    const operands: ASTNode[] = []
    while (this.reader.hasNext() && this.reader.peekToken() !== "]") {
      operands.push(this.parseExpression())
    }
    this.reader.expect("]")
    return { type: "math", operator, operands, start, end: this.reader.getPosition() }
  }

  // ---- calc "formula" ----
  private parseCalc(): CalcNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "calc"
    const tb = this.reader.nextTokenBlock()
    return { type: "calc", formula: tb.token, start, end: this.reader.getPosition() }
  }

  // ---- inline "template" ----
  private parseInline(): InlineNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "inline"
    const tb = this.reader.nextTokenBlock()
    return { type: "inline", template: tb.token, start, end: this.reader.getPosition() }
  }

  // ---- lazy EXPR ----
  private parseLazy(): LazyNode {
    const start = this.reader.getPosition()
    this.reader.nextToken() // consume "lazy"
    const expr = this.parseExpression()
    return { type: "lazy", expr, start, end: this.reader.getPosition() }
  }

  // ---- &VAR / &VAR[key] ----
  private parseVarRef(): VarRefNode {
    const start = this.reader.getPosition()
    const token = this.reader.nextToken() // &varName or &varName[key]
    const name = token.startsWith("&") ? token.slice(1) : token
    let key: string | null = null
    const bracketIdx = name.indexOf("[")
    if (bracketIdx !== -1 && name.endsWith("]")) {
      key = name.slice(bracketIdx + 1, -1)
      return { type: "var_ref", name: name.slice(0, bracketIdx), key, start, end: this.reader.getPosition() }
    }
    return { type: "var_ref", name, key: null, start, end: this.reader.getPosition() }
  }

  // ---- *VAR ----
  private parseLazyRef(): LazyRefNode {
    const start = this.reader.getPosition()
    const token = this.reader.nextToken()
    const name = token.startsWith("*") ? token.slice(1) : token
    return { type: "lazy_ref", name, start, end: this.reader.getPosition() }
  }

  // ---- Action 调用（schema 驱动） ----
  private parseActionCall(): ActionCallNode {
    const start = this.reader.getPosition()
    const name = this.reader.nextToken()
    const schemaAction = this.actionMap.get(name.toLowerCase())
    const args: ASTNode[] = []
    const keywordArgs: Record<string, ASTNode> = {}

    if (schemaAction) {
      // 按 schema 定义消费参数
      const positionalParams = schemaAction.params.filter(p => !p.keyword)
      const keywordParams = new Map(schemaAction.params.filter(p => p.keyword).map(p => [p.keyword!.toLowerCase(), p]))
      let posIdx = 0

      while (this.reader.hasNext()) {
        const peek = this.reader.peekToken()
        if (!peek || peek === "}" || peek === "]") break

        // 检查是否是 keyword 参数
        const kwParam = keywordParams.get(peek.toLowerCase())
        if (kwParam) {
          this.reader.nextToken() // consume keyword
          keywordArgs[kwParam.keyword!] = this.parseExpression()
          continue
        }

        // 检查是否是下一条语句的开始（另一个 action 名或关键字）
        if (this.isStatementStart(peek)) break

        // 消费位置参数
        if (posIdx < positionalParams.length) {
          args.push(this.parseExpression())
          posIdx++
        } else {
          break
        }
      }
    } else {
      // 未知 action：贪婪消费到行尾或块结束
      while (this.reader.hasNext()) {
        const peek = this.reader.peekToken()
        if (!peek || peek === "}" || peek === "]") break
        if (this.isStatementStart(peek)) break
        args.push(this.parseExpression())
      }
    }

    return { type: "action_call", name, args, keywordArgs, start, end: this.reader.getPosition() }
  }

  // ---- 表达式解析 ----
  private parseExpression(): ASTNode {
    if (!this.reader.hasNext()) {
      const pos = this.reader.getPosition()
      return { type: "error", message: "意外的文件结束", raw: "", start: pos, end: pos }
    }

    const start = this.reader.getPosition()
    const ch = this.reader.peek()

    // { } 块
    if (ch === "{") return this.parseBlock(null)

    // &变量引用
    if (ch === "&") return this.parseVarRef()

    // *延迟引用
    if (ch === "*") return this.parseLazyRef()

    // 引号字符串
    if (ch === '"' || ch === "'") {
      const tb = this.reader.nextTokenBlock()
      return { type: "string", value: tb.token, start, end: this.reader.getPosition() }
    }

    // [ ] 列表 — 不在这里处理，由 math/any/all/case 自行处理

    // 读取 token
    this.reader.mark()
    const token = this.reader.nextToken()
    const lower = token.toLowerCase()

    // 布尔值
    if (lower === "true" || lower === "false") {
      this.reader.unmark()
      return { type: "boolean", value: lower === "true", start, end: this.reader.getPosition() }
    }

    // 数字
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      this.reader.unmark()
      return { type: "number", value: parseFloat(token), start, end: this.reader.getPosition() }
    }

    // 内置表达式关键字
    if (lower === "check") { this.reader.reset(); return this.parseCheck() }
    if (lower === "any" || lower === "all") { this.reader.reset(); return this.parseLogic(lower as "any" | "all") }
    if (lower === "math") { this.reader.reset(); return this.parseMath() }
    if (lower === "calc") { this.reader.reset(); return this.parseCalc() }
    if (lower === "inline") { this.reader.reset(); return this.parseInline() }
    if (lower === "lazy") { this.reader.reset(); return this.parseLazy() }
    if (lower === "flag") { this.reader.reset(); return this.parseFlag() }
    if (lower === "set") { this.reader.reset(); return this.parseSet() }
    if (lower === "if") { this.reader.reset(); return this.parseIf() }
    if (lower === "for") { this.reader.reset(); return this.parseFor() }
    if (lower === "case") { this.reader.reset(); return this.parseCase() }

    // 选择器字符串 "@range 5 !@self"
    if (token.startsWith('"') && token.includes("@")) {
      this.reader.unmark()
      return this.parseSelectorString(token)
    }

    // 已知 action 名 → 递归解析为 action 调用
    if (this.actionMap.has(lower)) {
      this.reader.reset()
      return this.parseActionCall()
    }

    // 普通标识符
    this.reader.unmark()
    return { type: "identifier", name: token, start, end: this.reader.getPosition() }
  }

  // ---- 解析 body（单条语句或 { } 块） ----
  private parseBody(): ASTNode[] {
    if (!this.reader.hasNext()) return []
    if (this.reader.peekToken() === "{") {
      const block = this.parseBlock(null)
      return block.body
    }
    const stmt = this.parseStatement()
    return stmt ? [stmt] : []
  }

  // ---- 选择器字符串解析 ----
  private parseSelectorString(raw: string): SelectorNode {
    const start = this.reader.getPosition()
    const selectors: { name: string; negated: boolean; args: ASTNode[] }[] = []
    const parts = raw.split(/\s+/)
    let i = 0
    while (i < parts.length) {
      let part = parts[i]
      let negated = false
      if (part.startsWith("!@")) { negated = true; part = part.slice(1) }
      if (part.startsWith("@")) {
        const name = part.slice(1)
        const args: ASTNode[] = []
        i++
        // 消费数字参数
        while (i < parts.length && !parts[i].startsWith("@") && !parts[i].startsWith("!@")) {
          const arg = parts[i]
          const pos = this.reader.getPosition()
          if (/^-?\d+(\.\d+)?$/.test(arg)) {
            args.push({ type: "number", value: parseFloat(arg), start: pos, end: pos })
          } else {
            args.push({ type: "identifier", name: arg, start: pos, end: pos })
          }
          i++
        }
        selectors.push({ name, negated, args })
      } else {
        i++
      }
    }
    return { type: "selector", selectors, start, end: this.reader.getPosition() }
  }

  // ---- 判断 token 是否是语句开始 ----
  private isStatementStart(token: string): boolean {
    const lower = token.toLowerCase()
    if (BUILTIN_KEYWORDS.has(lower)) return true
    if (this.actionMap.has(lower)) return true
    return false
  }
}

// ============ AST → 文本 (stringify) ============

class KetherStringifier {
  private indent = 0

  stringify(node: ScriptNode): string {
    return node.body.map(n => this.node(n)).join("\n")
  }

  private pad(): string { return "  ".repeat(this.indent) }

  private node(n: ASTNode): string {
    switch (n.type) {
      case "script": return (n as ScriptNode).body.map(c => this.node(c)).join("\n")
      case "action_call": return this.actionCall(n as ActionCallNode)
      case "set": return `${this.pad()}set ${(n as SetNode).variable} to ${this.expr(n as SetNode)}`
      case "if": return this.ifNode(n as IfNode)
      case "for": return this.forNode(n as ForNode)
      case "case": return this.caseNode(n as CaseNode)
      case "block": return this.blockNode(n as BlockNode)
      case "flag": return this.flagNode(n as FlagNode)
      case "check": return `${this.pad()}check ${this.node((n as CheckNode).left)} ${(n as CheckNode).operator} ${this.node((n as CheckNode).right)}`
      case "logic": return `${this.pad()}${(n as LogicNode).operator} [ ${(n as LogicNode).conditions.map(c => this.node(c)).join(" ")} ]`
      case "math": return `math ${(n as MathNode).operator} [ ${(n as MathNode).operands.map(o => this.node(o)).join(" ")} ]`
      case "calc": return `calc "${(n as CalcNode).formula}"`
      case "inline": return `inline "${(n as InlineNode).template}"`
      case "lazy": return `lazy ${this.node((n as LazyNode).expr)}`
      case "var_ref": { const v = n as VarRefNode; return v.key ? `&${v.name}[${v.key}]` : `&${v.name}` }
      case "lazy_ref": return `*${(n as LazyRefNode).name}`
      case "selector": return this.selectorNode(n as SelectorNode)
      case "number": return String((n as NumberNode).value)
      case "string": return `"${(n as StringNode).value}"`
      case "boolean": return String((n as BooleanNode).value)
      case "identifier": return (n as IdentifierNode).name
      case "comment": return `# ${(n as CommentNode).text}`
      case "error": return `# ERROR: ${(n as ErrorNode).raw}`
      default: return ""
    }
  }

  private expr(setNode: SetNode): string { return this.node(setNode.value) }

  private actionCall(n: ActionCallNode): string {
    const parts = [this.pad() + n.name]
    for (const arg of n.args) parts.push(this.node(arg))
    for (const [kw, val] of Object.entries(n.keywordArgs)) {
      parts.push(kw)
      parts.push(this.node(val))
    }
    return parts.join(" ")
  }

  private ifNode(n: IfNode): string {
    let result = `${this.pad()}if ${this.node(n.condition)} then {\n`
    this.indent++
    result += n.thenBody.map(s => this.node(s)).join("\n") + "\n"
    this.indent--
    result += `${this.pad()}}`
    for (const clause of n.elseIfClauses) {
      result += ` else if ${this.node(clause.condition)} then {\n`
      this.indent++
      result += clause.body.map(s => this.node(s)).join("\n") + "\n"
      this.indent--
      result += `${this.pad()}}`
    }
    if (n.elseBody) {
      result += ` else {\n`
      this.indent++
      result += n.elseBody.map(s => this.node(s)).join("\n") + "\n"
      this.indent--
      result += `${this.pad()}}`
    }
    return result
  }

  private forNode(n: ForNode): string {
    let result = `${this.pad()}for ${n.variable} in ${this.node(n.iterable)} then {\n`
    this.indent++
    result += n.body.map(s => this.node(s)).join("\n") + "\n"
    this.indent--
    result += `${this.pad()}}`
    return result
  }

  private caseNode(n: CaseNode): string {
    let result = `${this.pad()}case ${this.node(n.expr)} [\n`
    this.indent++
    for (const w of n.whenClauses) {
      result += `${this.pad()}when ${this.node(w.value)} -> ${this.node(w.body)}\n`
    }
    if (n.elseClause) result += `${this.pad()}else ${this.node(n.elseClause)}\n`
    this.indent--
    result += `${this.pad()}]`
    return result
  }

  private blockNode(n: BlockNode): string {
    const prefix = n.modifier ? `${this.pad()}${n.modifier} {\n` : `${this.pad()}{\n`
    this.indent++
    const body = n.body.map(s => this.node(s)).join("\n") + "\n"
    this.indent--
    return prefix + body + `${this.pad()}}`
  }

  private flagNode(n: FlagNode): string {
    let result = `${this.pad()}flag ${this.node(n.name)}`
    if (n.operation === "set") result += ` to ${this.node(n.value!)}`
    else if (n.operation === "remove") result += " remove"
    if (n.timeout) result += ` timeout ${this.node(n.timeout)}`
    return result
  }

  private selectorNode(n: SelectorNode): string {
    const parts = n.selectors.map(s => {
      const prefix = s.negated ? "!@" : "@"
      const args = s.args.map(a => this.node(a)).join(" ")
      return args ? `${prefix}${s.name} ${args}` : `${prefix}${s.name}`
    })
    return `"${parts.join(" ")}"`
  }
}

// ============ 导出 ============

export function parseKether(source: string, schema?: ActionsSchema): ScriptNode {
  const parser = new KetherParser(source, schema)
  return parser.parse()
}

export function stringifyKether(ast: ScriptNode): string {
  return new KetherStringifier().stringify(ast)
}
