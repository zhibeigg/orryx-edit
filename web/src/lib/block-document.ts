import {
  parseKether,
  stringifyNode,
  type ASTNode,
  type ActionCallNode,
  type IfNode,
  type ForNode,
  type CaseNode,
  type BlockNode,
  type SetNode,
  type CheckNode,
  type LogicNode,
  type MathNode,
  type CalcNode,
  type ScriptNode,
} from "./kether-ast"
import {
  buildSchemaCatalog,
  canFillInput,
  catalogActionsForName,
  keywordAlternatives,
  type BlockShape,
  type SchemaAction,
  type SchemaCatalog,
  type SchemaInput,
  type UnifiedActionsSchema,
} from "@/types/schema"
import { toParserActionsSchema } from "@/types/schema"

export type BlockInput =
  | { kind: "literal"; type: string; value: unknown; serialization: "token" | "quoted" | "raw" | "json" | "duration" }
  | { kind: "block"; blockId: string }
  | { kind: "raw"; type: string; source: string }

export interface DocumentBlock {
  id: string
  kind: BlockShape
  opcode: string
  actionId?: string
  variantId?: string
  outputType?: string
  inputs: Record<string, BlockInput>
  branches: Record<string, string[]>
  source?: string
  order: number
  parent?: { blockId: string; slot: string } | null
}

export interface BlockDocument {
  version: 1
  roots: string[]
  blocks: Record<string, DocumentBlock>
}

export interface DockingResult {
  accepted: boolean
  reason?: string
}

interface BuildContext {
  catalog: SchemaCatalog
  source: string
  blocks: Record<string, DocumentBlock>
  counter: number
}

function nextBlockId(context: BuildContext, prefix: string, offset: number): string {
  context.counter += 1
  return `${prefix}-${offset}-${context.counter}`
}

function sourceForNode(node: ASTNode, source: string): string {
  const exact = source.slice(node.start.offset, node.end.offset).trim()
  return exact || stringifyNode(node)
}

function literalInput(node: ASTNode, type: string, serialization: Extract<BlockInput, { kind: "literal" }>["serialization"]): BlockInput {
  switch (node.type) {
    case "number": return { kind: "literal", type, value: node.value, serialization: "token" }
    case "boolean": return { kind: "literal", type, value: node.value, serialization: "token" }
    case "string": return { kind: "literal", type, value: node.value, serialization: "quoted" }
    case "identifier": return { kind: "literal", type, value: node.name, serialization }
    case "var_ref": return { kind: "raw", type, source: node.key ? `&${node.name}[${node.key}]` : `&${node.name}` }
    case "lazy_ref": return { kind: "raw", type, source: `*${node.name}` }
    default: return { kind: "raw", type, source: stringifyNode(node) }
  }
}

function resolveAction(node: ActionCallNode, catalog: SchemaCatalog): SchemaAction | null {
  if (node.variantId) return catalog.byVariantId.get(node.variantId) ?? catalog.byId.get(node.variantId) ?? null
  return catalogActionsForName(catalog, node.name)[0] ?? null
}

function expressionToInput(node: ASTNode, input: SchemaInput, context: BuildContext, parentId: string): BlockInput {
  if (["action_call", "check", "logic", "math", "calc"].includes(node.type)) {
    const childId = convertNode(node, context, { blockId: parentId, slot: input.key }, 0)
    if (childId) return { kind: "block", blockId: childId }
  }
  const type = context.catalog.schema.types[input.type]
  if (!type?.ketherFillable && node.type !== "string" && node.type !== "identifier" && node.type !== "number" && node.type !== "boolean") {
    return { kind: "raw", type: input.type, source: sourceForNode(node, context.source) }
  }
  return literalInput(node, input.type, type?.serialization ?? "raw")
}

function typedExpressionInput(
  node: ASTNode,
  type: string,
  context: BuildContext,
  parentId: string,
  key: string,
  accepts: string[] = [type],
): BlockInput {
  return expressionToInput(node, {
    name: key,
    key,
    type,
    accepts,
    required: true,
    default: null,
  }, context, parentId)
}

function convertAction(node: ActionCallNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const action = resolveAction(node, context.catalog)
  if (!action) return convertRaw(node, context, parent, order, `未知 action ${node.name}`)
  const positional = action.inputs.filter((input) => keywordAlternatives(input).length === 0)
  const unmatchedKeyword = Object.keys(node.keywordArgs).some((keyword) => !action.inputs.some((input) => (
    keywordAlternatives(input).some((alternative) => alternative.toLowerCase() === keyword.toLowerCase())
    || input.keyword?.toLowerCase() === keyword.toLowerCase()
  )))
  if (node.args.length > positional.length || unmatchedKeyword) {
    return convertRaw(node, context, parent, order, `action ${node.name} 的 grammar 尚未完整映射`)
  }
  const id = nextBlockId(context, action.shape, node.start.offset)
  const block: DocumentBlock = {
    id,
    kind: action.shape,
    opcode: node.name,
    actionId: action.id,
    variantId: action.variantId,
    outputType: action.output?.type,
    inputs: {},
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  context.blocks[id] = block
  node.args.forEach((argument, index) => {
    const input = positional[index]
    if (input) block.inputs[input.key] = expressionToInput(argument, input, context, id)
  })
  for (const [keyword, argument] of Object.entries(node.keywordArgs)) {
    const input = action.inputs.find((candidate) => keywordAlternatives(candidate).some((alternative) => alternative.toLowerCase() === keyword.toLowerCase()) || candidate.keyword?.toLowerCase() === keyword.toLowerCase())
    if (input) block.inputs[input.key] = expressionToInput(argument, input, context, id)
  }
  return id
}

function convertIf(node: IfNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "container", node.start.offset)
  const block: DocumentBlock = {
    id,
    kind: "container",
    opcode: "if",
    outputType: "unit",
    inputs: { condition: typedExpressionInput(node.condition, "predicate", context, id, "condition", ["predicate", "boolean"]) },
    branches: { then: [], else: [] },
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  context.blocks[id] = block
  block.branches.then = convertSequence(node.thenBody, context, id, "then")
  const elseNodes: ASTNode[] = [...(node.elseBody ?? [])]
  for (let index = node.elseIfClauses.length - 1; index >= 0; index -= 1) {
    const clause = node.elseIfClauses[index]
    if (!clause) continue
    elseNodes.unshift({
      type: "if",
      condition: clause.condition,
      thenBody: clause.body,
      elseIfClauses: [],
      elseBody: elseNodes.length > 0 ? elseNodes : null,
      start: clause.condition.start,
      end: clause.body.at(-1)?.end ?? clause.condition.end,
    })
  }
  block.branches.else = convertSequence(elseNodes, context, id, "else")
  return id
}

function convertFor(node: ForNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "container", node.start.offset)
  const block: DocumentBlock = {
    id,
    kind: "container",
    opcode: "for",
    outputType: "unit",
    inputs: {
      variable: { kind: "literal", type: "text", value: node.variable, serialization: "token" },
      iterable: typedExpressionInput(node.iterable, "reporter", context, id, "iterable", ["reporter", "list", "collection", "any"]),
    },
    branches: { body: [] },
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  context.blocks[id] = block
  block.branches.body = convertSequence(node.body, context, id, "body")
  return id
}

function convertSet(node: SetNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "command", node.start.offset)
  context.blocks[id] = {
    id,
    kind: "command",
    opcode: "set",
    outputType: "unit",
    inputs: {
      variable: { kind: "literal", type: "text", value: node.variable, serialization: "token" },
      value: typedExpressionInput(node.value, "any", context, id, "value"),
    },
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertCase(node: CaseNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "container", node.start.offset)
  const block: DocumentBlock = {
    id,
    kind: "container",
    opcode: "case",
    outputType: "any",
    inputs: { value: typedExpressionInput(node.expr, "any", context, id, "value") },
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  context.blocks[id] = block
  node.whenClauses.forEach((clause, index) => {
    const slot = `when:${index}`
    block.inputs[slot] = typedExpressionInput(clause.value, "any", context, id, slot)
    const childId = convertNode(clause.body, context, { blockId: id, slot }, 0)
    block.branches[slot] = childId ? [childId] : []
  })
  if (node.elseClause) {
    const childId = convertNode(node.elseClause, context, { blockId: id, slot: "else" }, 0)
    block.branches.else = childId ? [childId] : []
  }
  return id
}

function convertAnonymousBlock(node: BlockNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "container", node.start.offset)
  const block: DocumentBlock = {
    id,
    kind: "container",
    opcode: node.modifier ?? "block",
    outputType: "unit",
    inputs: {},
    branches: { body: [] },
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  context.blocks[id] = block
  block.branches.body = convertSequence(node.body, context, id, "body")
  return id
}

function convertCheck(node: CheckNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "predicate", node.start.offset)
  context.blocks[id] = {
    id,
    kind: "predicate",
    opcode: "check",
    outputType: "boolean",
    inputs: {
      left: typedExpressionInput(node.left, "any", context, id, "left"),
      operator: { kind: "literal", type: "keyword", value: node.operator, serialization: "token" },
      right: typedExpressionInput(node.right, "any", context, id, "right"),
    },
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertLogic(node: LogicNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "predicate", node.start.offset)
  const inputs: Record<string, BlockInput> = {}
  node.conditions.forEach((condition, index) => {
    inputs[`condition:${index}`] = typedExpressionInput(condition, "predicate", context, id, `condition:${index}`, ["predicate", "boolean"])
  })
  context.blocks[id] = {
    id,
    kind: "predicate",
    opcode: node.operator,
    outputType: "boolean",
    inputs,
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertMath(node: MathNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "reporter", node.start.offset)
  const inputs: Record<string, BlockInput> = {
    operator: { kind: "literal", type: "keyword", value: node.operator, serialization: "token" },
  }
  node.operands.forEach((operand, index) => {
    inputs[`operand:${index}`] = typedExpressionInput(operand, "number", context, id, `operand:${index}`, ["number"])
  })
  context.blocks[id] = {
    id,
    kind: "reporter",
    opcode: "math",
    outputType: "number",
    inputs,
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertCalc(node: CalcNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string {
  const id = nextBlockId(context, "reporter", node.start.offset)
  context.blocks[id] = {
    id,
    kind: "reporter",
    opcode: "calc",
    outputType: "number",
    inputs: { formula: { kind: "literal", type: "text", value: node.formula, serialization: "quoted" } },
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertRaw(node: ASTNode, context: BuildContext, parent: DocumentBlock["parent"], order: number, reason?: string): string {
  const id = nextBlockId(context, "raw", node.start.offset)
  context.blocks[id] = {
    id,
    kind: "raw",
    opcode: reason ? `raw: ${reason}` : "raw",
    outputType: "raw",
    inputs: { source: { kind: "raw", type: "raw", source: sourceForNode(node, context.source) } },
    branches: {},
    source: sourceForNode(node, context.source),
    order,
    parent,
  }
  return id
}

function convertNode(node: ASTNode, context: BuildContext, parent: DocumentBlock["parent"], order: number): string | null {
  switch (node.type) {
    case "action_call": return convertAction(node, context, parent, order)
    case "set": return convertSet(node, context, parent, order)
    case "if": return convertIf(node, context, parent, order)
    case "for": return convertFor(node, context, parent, order)
    case "case": return convertCase(node, context, parent, order)
    case "block": return convertAnonymousBlock(node, context, parent, order)
    case "check": return convertCheck(node, context, parent, order)
    case "logic": return convertLogic(node, context, parent, order)
    case "math": return convertMath(node, context, parent, order)
    case "calc": return convertCalc(node, context, parent, order)
    case "comment":
    case "error":
    case "raw":
    case "list":
    case "inline":
    case "lazy":
    case "flag":
    case "selector":
      return convertRaw(node, context, parent, order)
    case "var_ref":
    case "lazy_ref":
    case "number":
    case "string":
    case "boolean":
    case "identifier":
      return convertRaw(node, context, parent, order, "顶层表达式")
    case "script": return null
  }
}

function convertSequence(nodes: ASTNode[], context: BuildContext, parentId?: string, slot?: string): string[] {
  const result: string[] = []
  nodes.forEach((node, order) => {
    const id = convertNode(node, context, parentId && slot ? { blockId: parentId, slot } : null, order)
    if (id) result.push(id)
  })
  return result
}

function appendRawGap(document: BlockDocument, source: string, start: number, end: number, order: number) {
  const raw = source.slice(start, end)
  if (!raw.trim()) return
  const id = `raw-gap-${start}-${end}`
  document.blocks[id] = {
    id,
    kind: "raw",
    opcode: "raw",
    outputType: "raw",
    inputs: { source: { kind: "raw", type: "raw", source: raw.trim() } },
    branches: {},
    source: raw.trim(),
    order,
    parent: null,
  }
  document.roots.push(id)
}

export function blockDocumentFromAst(ast: ScriptNode, schema: UnifiedActionsSchema, source = ""): BlockDocument {
  const context: BuildContext = { catalog: buildSchemaCatalog(schema), source, blocks: {}, counter: 0 }
  const document: BlockDocument = { version: 1, roots: [], blocks: context.blocks }
  let cursor = 0
  let order = 0
  for (const node of ast.body) {
    if (source) appendRawGap(document, source, cursor, node.start.offset, order++)
    const id = convertNode(node, context, null, order++)
    if (id) document.roots.push(id)
    cursor = Math.max(cursor, node.end.offset)
  }
  if (source) appendRawGap(document, source, cursor, source.length, order)
  document.roots.forEach((id, index) => { if (document.blocks[id]) document.blocks[id].order = index })
  return document
}

export function parseBlockDocument(source: string, schema: UnifiedActionsSchema): BlockDocument {
  return blockDocumentFromAst(parseKether(source, toParserActionsSchema(schema)), schema, source)
}

function serializeLiteral(input: Extract<BlockInput, { kind: "literal" }>): string {
  const value = input.value == null ? "" : String(input.value)
  if (input.serialization === "quoted") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  if (input.serialization === "json") return typeof input.value === "string" ? input.value : JSON.stringify(input.value)
  return value
}

function serializeInput(input: BlockInput, document: BlockDocument, catalog?: SchemaCatalog): string {
  if (input.kind === "block") return serializeBlock(input.blockId, document, true, catalog)
  if (input.kind === "raw") return input.source
  return serializeLiteral(input)
}

function serializeAction(block: DocumentBlock, document: BlockDocument, action: SchemaAction, catalog?: SchemaCatalog): string {
  const parts = [block.opcode || action.name]
  for (const input of action.inputs) {
    const value = block.inputs[input.key]
    if (!value) continue
    const alternatives = keywordAlternatives(input)
    if (alternatives.length > 0) {
      const keyword = alternatives[0]
      if (!keyword) continue
      if (input.type.toLowerCase() === "keyword" || input.keywords?.mode === "flag") {
        const actual = value.kind === "literal" ? String(value.value || keyword) : keyword
        parts.push(alternatives.includes(actual) ? actual : keyword)
      } else {
        parts.push(keyword, serializeInput(value, document, catalog))
      }
    } else {
      parts.push(serializeInput(value, document, catalog))
    }
  }
  return parts.filter(Boolean).join(" ")
}

function serializeActionWithSlots(block: DocumentBlock, document: BlockDocument, action: SchemaAction, catalog?: SchemaCatalog): string {
  let result = serializeAction(block, document, action, catalog)
  for (const slot of action.slots ?? []) {
    const body = serializeBranch(block.branches[slot.name] ?? [], document, catalog)
    if (!body) continue
    const keyword = slot.name === "then" ? " then" : slot.name === "else" ? " else" : ""
    result += `${keyword} {\n${indent(body)}\n}`
  }
  return result
}

function indent(text: string, depth = 1): string {
  const prefix = "  ".repeat(depth)
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n")
}

function serializeBranch(ids: string[], document: BlockDocument, catalog?: SchemaCatalog): string {
  return ids.map((id) => serializeBlock(id, document, false, catalog)).filter(Boolean).join("\n")
}

function serializeBlock(id: string, document: BlockDocument, inline = false, catalog?: SchemaCatalog): string {
  const block = document.blocks[id]
  if (!block) return ""
  const input = (key: string, fallback = "") => block.inputs[key] ? serializeInput(block.inputs[key], document, catalog) : fallback
  const compact = (text: string) => inline ? text.replace(/\n\s*/g, " ") : text
  if (block.kind === "raw") {
    const source = block.inputs.source
    return source?.kind === "raw" ? source.source : block.source ?? ""
  }
  if (block.opcode === "set") return `set ${input("variable", "value")} to ${input("value", "null")}`
  if (block.opcode === "if") {
    const thenBody = serializeBranch(block.branches.then ?? [], document, catalog)
    const elseBody = serializeBranch(block.branches.else ?? [], document, catalog)
    return compact(`if ${input("condition", "true")} then {\n${indent(thenBody)}\n}${elseBody ? ` else {\n${indent(elseBody)}\n}` : ""}`)
  }
  if (block.opcode === "for") {
    const body = serializeBranch(block.branches.body ?? [], document, catalog)
    return compact(`for ${input("variable", "item")} in ${input("iterable", "&items")} then {\n${indent(body)}\n}`)
  }
  if (block.opcode === "case") {
    const clauses = Object.keys(block.branches).filter((slot) => slot.startsWith("when:")).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]))
    const lines = clauses.map((slot) => `when ${input(slot, "null")} -> ${serializeBranch(block.branches[slot] ?? [], document, catalog) || "null"}`)
    const elseBody = serializeBranch(block.branches.else ?? [], document, catalog)
    if (elseBody) lines.push(`else ${elseBody}`)
    return compact(`case ${input("value", "null")} [\n${indent(lines.join("\n"))}\n]`)
  }
  if (block.opcode === "block" || block.opcode === "sync" || block.opcode === "async") {
    const body = serializeBranch(block.branches.body ?? [], document, catalog)
    const prefix = block.opcode === "block" ? "" : `${block.opcode} `
    return compact(`${prefix}{\n${indent(body)}\n}`)
  }
  if (block.opcode === "check") return `check ${input("left", "null")} ${input("operator", "==")} ${input("right", "null")}`
  if (block.opcode === "any" || block.opcode === "all") {
    const values = Object.keys(block.inputs).filter((key) => key.startsWith("condition:")).sort().map((key) => input(key))
    return `${block.opcode} [ ${values.join(" ")} ]`
  }
  if (block.opcode === "math") {
    const values = Object.keys(block.inputs).filter((key) => key.startsWith("operand:")).sort().map((key) => input(key))
    return `math ${input("operator", "+")} [ ${values.join(" ")} ]`
  }
  if (block.opcode === "calc") return `calc ${input("formula", "\"\"")}`
  const action = block.actionId ? catalog?.byId.get(block.actionId) : undefined
  if (action) return serializeActionWithSlots(block, document, action, catalog)
  return block.source ?? block.opcode
}

export function serializeBlockDocument(document: BlockDocument, schema: UnifiedActionsSchema): string {
  const catalog = buildSchemaCatalog(schema)
  return [...document.roots]
    .sort((left, right) => (document.blocks[left]?.order ?? 0) - (document.blocks[right]?.order ?? 0))
    .map((id) => serializeBlock(id, document, false, catalog))
    .filter(Boolean)
    .join("\n")
}

export function canDockBlock(schema: UnifiedActionsSchema, source: DocumentBlock, targetInput: SchemaInput): DockingResult {
  const targetType = schema.types[targetInput.type]
  if (!targetType) return { accepted: false, reason: `未知目标类型 ${targetInput.type}` }
  if (!targetType.ketherFillable) return { accepted: false, reason: `${targetInput.type} 必须使用 raw 原始类型编辑器` }
  const outputType = source.outputType ?? "any"
  return canFillInput(schema.types, outputType, targetInput)
    ? { accepted: true }
    : { accepted: false, reason: `${outputType} 不能赋值给 ${targetInput.accepts.join(" | ")}` }
}

export function reorderDocumentBlocks(document: BlockDocument, parent: DocumentBlock["parent"], orderedIds: string[]): BlockDocument {
  const next: BlockDocument = {
    ...document,
    roots: [...document.roots],
    blocks: Object.fromEntries(Object.entries(document.blocks).map(([id, block]) => [id, { ...block, inputs: { ...block.inputs }, branches: Object.fromEntries(Object.entries(block.branches).map(([slot, ids]) => [slot, [...ids]])) }])),
  }
  orderedIds.forEach((id, order) => { if (next.blocks[id]) next.blocks[id].order = order })
  if (!parent) next.roots = [...orderedIds]
  else if (next.blocks[parent.blockId]) next.blocks[parent.blockId].branches[parent.slot] = [...orderedIds]
  return next
}
