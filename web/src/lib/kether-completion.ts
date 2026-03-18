// Kether 智能补全 — 基于 AST + actions-schema.json
// 替换 kether-language.ts 中的硬编码补全

import type { ActionsSchema, SchemaAction, ASTNode } from "./kether-ast"
import { parseKether } from "./kether-ast"

export interface CompletionItem {
  label: string
  kind: "action" | "keyword" | "variable" | "selector" | "property" | "enum" | "snippet"
  detail?: string
  documentation?: string
  insertText?: string
  sortOrder?: number
}

interface CompletionContext {
  lineText: string
  cursorOffset: number
  wordBefore: string
  charBefore: string
  fullText: string
  lineNumber: number
}

// 收集脚本中所有 set 语句定义的变量
function collectVariables(ast: ASTNode): string[] {
  const vars: string[] = []
  function walk(node: ASTNode) {
    if (node.type === "set") vars.push((node as { variable: string }).variable)
    if (node.type === "script") for (const c of (node as { body: ASTNode[] }).body) walk(c)
    if (node.type === "if") {
      const n = node as { thenBody: ASTNode[]; elseIfClauses: { body: ASTNode[] }[]; elseBody: ASTNode[] | null }
      for (const c of n.thenBody) walk(c)
      for (const clause of n.elseIfClauses) for (const c of clause.body) walk(c)
      if (n.elseBody) for (const c of n.elseBody) walk(c)
    }
    if (node.type === "for") {
      vars.push((node as { variable: string }).variable)
      for (const c of (node as { body: ASTNode[] }).body) walk(c)
    }
    if (node.type === "block") for (const c of (node as { body: ASTNode[] }).body) walk(c)
  }
  walk(ast)
  return [...new Set(vars)]
}

// 收集脚本中所有 flag 名
function collectFlags(ast: ASTNode): string[] {
  const flags: string[] = []
  function walk(node: ASTNode) {
    if (node.type === "flag") {
      const name = (node as { name: ASTNode }).name
      if (name.type === "identifier") flags.push((name as { name: string }).name)
    }
    if (node.type === "script") for (const c of (node as { body: ASTNode[] }).body) walk(c)
    if (node.type === "if") {
      const n = node as { thenBody: ASTNode[]; elseIfClauses: { body: ASTNode[] }[]; elseBody: ASTNode[] | null }
      for (const c of n.thenBody) walk(c)
      for (const clause of n.elseIfClauses) for (const c of clause.body) walk(c)
      if (n.elseBody) for (const c of n.elseBody) walk(c)
    }
    if (node.type === "for") for (const c of (node as { body: ASTNode[] }).body) walk(c)
    if (node.type === "block") for (const c of (node as { body: ASTNode[] }).body) walk(c)
  }
  walk(ast)
  return [...new Set(flags)]
}

// 判断光标是否在注释中
function isInComment(lineText: string, column: number): boolean {
  for (let i = 0; i < column && i < lineText.length; i++) {
    if (lineText[i] === "#") return true
    if (lineText[i] === '"') {
      i++
      while (i < lineText.length && lineText[i] !== '"') {
        if (lineText[i] === "\\") i++
        i++
      }
    }
  }
  return false
}

// 找到光标前最近的 action 名
function findContextAction(lineText: string, column: number, schema: ActionsSchema): SchemaAction | null {
  const textBefore = lineText.slice(0, column).trim()
  const tokens = textBefore.split(/\s+/)
  // 从右向左找第一个匹配的 action
  for (let i = tokens.length - 1; i >= 0; i--) {
    const lower = tokens[i].toLowerCase()
    const action = schema.actions.find(a =>
      a.name.toLowerCase() === lower ||
      (a.aliases ?? []).some(al => al.toLowerCase() === lower)
    )
    if (action) return action
  }
  return null
}

// 计算当前参数位置
function getParamIndex(lineText: string, column: number, actionName: string): number {
  const textBefore = lineText.slice(0, column)
  const actionIdx = textBefore.toLowerCase().indexOf(actionName.toLowerCase())
  if (actionIdx === -1) return 0
  const afterAction = textBefore.slice(actionIdx + actionName.length)
  // 计算空白分隔的 token 数量
  const tokens = afterAction.trim().split(/\s+/).filter(Boolean)
  return tokens.length
}

export function getCompletions(ctx: CompletionContext, schema: ActionsSchema, skillVariables?: Record<string, unknown>): CompletionItem[] {
  const items: CompletionItem[] = []

  // 注释内不补全
  if (isInComment(ctx.lineText, ctx.cursorOffset)) return []

  const word = ctx.wordBefore.toLowerCase()

  // 1. & 变量引用
  if (ctx.charBefore === "&" || ctx.wordBefore.startsWith("&")) {
    // 从 AST 收集变量
    try {
      const ast = parseKether(ctx.fullText, schema)
      const vars = collectVariables(ast)
      for (const v of vars) {
        items.push({ label: `&${v}`, kind: "variable", detail: "局部变量", insertText: v, sortOrder: 0 })
      }
    } catch { /* ignore */ }
    // 从 skill Variables 收集
    if (skillVariables) {
      for (const [k, v] of Object.entries(skillVariables)) {
        items.push({ label: `&${k}`, kind: "variable", detail: `Variables: ${v}`, insertText: k, sortOrder: 1 })
      }
    }
    // 内置变量
    for (const v of ["level", "event", "pressTick", "triggerType", "isCancelled"]) {
      items.push({ label: `&${v}`, kind: "variable", detail: "内置变量", insertText: v, sortOrder: 2 })
    }
    return items
  }

  // 2. * 延迟引用
  if (ctx.charBefore === "*" || ctx.wordBefore.startsWith("*")) {
    if (skillVariables) {
      for (const [k, v] of Object.entries(skillVariables)) {
        items.push({ label: `*${k}`, kind: "variable", detail: `lazy: ${v}`, insertText: k, sortOrder: 0 })
      }
    }
    return items
  }

  // 3. @ 选择器
  if (ctx.charBefore === "@" || ctx.wordBefore.startsWith("@")) {
    for (const sel of schema.selectors ?? []) {
      const paramHint = sel.params.map(p => `${p.name}: ${p.type}`).join(", ")
      items.push({
        label: `@${sel.name}`,
        kind: "selector",
        detail: paramHint || "无参数",
        insertText: sel.name,
        sortOrder: 0,
      })
    }
    return items
  }

  // 4. &变量名[ 后的属性补全
  if (ctx.wordBefore.includes("[") && ctx.wordBefore.includes("&")) {
    for (const prop of schema.properties ?? []) {
      const p = prop as { name: string; keys: { name: string; type: string; description?: string }[] }
      for (const key of p.keys) {
        items.push({
          label: key.name,
          kind: "property",
          detail: `${p.name}.${key.name}: ${key.type}`,
          documentation: key.description,
          sortOrder: 0,
        })
      }
    }
    return items
  }

  // 5. flag 后补全 flag 名
  const trimmed = ctx.lineText.slice(0, ctx.cursorOffset).trim()
  if (/\bflag\s+$/i.test(trimmed) || /\bflag\s+\S*$/i.test(trimmed)) {
    try {
      const ast = parseKether(ctx.fullText, schema)
      const flags = collectFlags(ast)
      for (const f of flags) {
        items.push({ label: f, kind: "variable", detail: "Flag", sortOrder: 0 })
      }
    } catch { /* ignore */ }
    return items
  }

  // 6. Action 参数补全（光标在 action 后面）
  const contextAction = findContextAction(ctx.lineText, ctx.cursorOffset, schema)
  if (contextAction) {
    const paramIdx = getParamIndex(ctx.lineText, ctx.cursorOffset, contextAction.name)
    // keyword 参数提示
    for (const p of contextAction.params.filter(p => p.keyword)) {
      if (!ctx.lineText.toLowerCase().includes(p.keyword!.toLowerCase())) {
        items.push({
          label: p.keyword!,
          kind: "keyword",
          detail: `${p.name}: ${p.type}`,
          sortOrder: 1,
        })
      }
    }
    // 当前位置参数的 enum 选项
    const positionalParams = contextAction.params.filter(p => !p.keyword)
    if (paramIdx < positionalParams.length) {
      const param = positionalParams[paramIdx]
      if (param.options) {
        for (const opt of param.options) {
          items.push({ label: opt, kind: "enum", detail: `${param.name} 选项`, sortOrder: 0 })
        }
      }
      // 类型提示
      items.push({
        label: `<${param.name}>`,
        kind: "keyword",
        detail: `参数 ${paramIdx + 1}: ${param.type}${param.optional ? " (可选)" : ""}`,
        sortOrder: 10,
      })
    }
    if (items.length > 0) return items
  }

  // 7. 行首 / 通用补全 — action 名 + 关键字
  // 关键字
  for (const kw of ["set", "if", "for", "case", "sync", "async", "flag", "check", "math", "calc", "inline", "lazy", "exit"]) {
    if (!word || kw.startsWith(word)) {
      items.push({ label: kw, kind: "keyword", detail: "Kether 关键字", sortOrder: 2 })
    }
  }

  // Action 名
  const seen = new Set<string>()
  for (const action of schema.actions) {
    if (seen.has(action.name)) continue
    seen.add(action.name)
    if (!word || action.name.toLowerCase().startsWith(word)) {
      const paramHint = action.params.slice(0, 3).map(p => p.name).join(", ")
      items.push({
        label: action.name,
        kind: "action",
        detail: `${action.category ?? "misc"} — ${paramHint}`,
        documentation: action.params.map(p => `${p.name}: ${p.type}${p.keyword ? ` (${p.keyword})` : ""}`).join("\n"),
        sortOrder: 1,
      })
    }
  }

  return items
}
