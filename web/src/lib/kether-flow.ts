import type { Connection } from "@xyflow/react"
import type {
  ASTNode, ScriptNode, ActionCallNode, SetNode as ASTSetNode,
  IfNode, ForNode, CalcNode as ASTCalcNode, VarRefNode,
  NumberNode, StringNode, BooleanNode, IdentifierNode, LazyRefNode
} from "./kether-ast"
import { parseKether } from "./kether-ast"
import { toParserActionsSchema, type ActionsSchemaV2, type SchemaAction, type SchemaInput } from "@/types/schema"
import type {
  KetherNode, KetherEdge, KetherNodeData, FlowState, KetherInputKind
} from "@/components/editor/flow/flow-types"

let nodeIdCounter = 0
function nextId(prefix: string): string {
  return `${prefix}_${++nodeIdCounter}`
}

export interface FlowCompatibility {
  writable: boolean
  reasons: string[]
}

export type FlowConnectionResult =
  | { accepted: true; state: FlowState; kind: "data" | "execution" }
  | { accepted: false; state: FlowState; reason: string }

const SIMPLE_EXPRESSION_TYPES = new Set<ASTNode["type"]>([
  "number", "string", "boolean", "identifier", "var_ref", "lazy_ref",
])

function buildActionMap(schema: ActionsSchemaV2): Map<string, SchemaAction> {
  const map = new Map<string, SchemaAction>()
  for (const action of schema.actions) {
    map.set(action.name.toLowerCase(), action)
    for (const alias of action.aliases ?? []) map.set(alias.toLowerCase(), action)
  }
  return map
}

function hasComment(source: string): boolean {
  let quote: "'" | "\"" | null = null
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\" && quote === "\"") {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === "'" || character === "\"") {
      quote = character
      continue
    }
    if (character === "#" || (character === "/" && next === "/")) return true
  }

  return false
}

function describeComplexExpression(node: ASTNode): string | null {
  return SIMPLE_EXPRESSION_TYPES.has(node.type) ? null : node.type
}

/** 判断脚本是否能由节点编辑器无损回写。 */
export function analyzeFlowCompatibility(
  ast: ScriptNode,
  schema: ActionsSchemaV2,
  source = ""
): FlowCompatibility {
  const reasons = new Set<string>()
  const actionMap = buildActionMap(schema)

  if (source && hasComment(source)) reasons.add("脚本包含注释")

  const checkExpression = (node: ASTNode, context: string) => {
    const unsupportedType = describeComplexExpression(node)
    if (unsupportedType) reasons.add(`${context} 使用复杂表达式 ${unsupportedType}`)
  }

  const visit = (node: ASTNode, context: string) => {
    switch (node.type) {
      case "action_call": {
        const action = actionMap.get(node.name.toLowerCase())
        if (!action && (node.args.length > 0 || Object.keys(node.keywordArgs).length > 0)) {
          reasons.add(`未知 action ${node.name} 带有参数`)
        }
        if (action) {
          const positionalInputs = action.inputs.filter((input) => !input.keyword)
          const keywordInputs = new Map(
            action.inputs
              .filter((input) => Boolean(input.keyword))
              .map((input) => [String(input.keyword).toLowerCase(), input])
          )
          if (node.args.length > positionalInputs.length) reasons.add(`${node.name} 的位置参数无法映射到 V2 schema`)
          for (const keyword of Object.keys(node.keywordArgs)) {
            if (!keywordInputs.has(keyword.toLowerCase())) reasons.add(`${node.name} 的关键字参数 ${keyword} 无法映射到 V2 schema`)
          }
        }
        node.args.forEach((argument, index) => checkExpression(argument, `${context} 参数 ${index + 1}`))
        for (const [keyword, argument] of Object.entries(node.keywordArgs)) {
          checkExpression(argument, `${context} 参数 ${keyword}`)
        }
        break
      }
      case "set":
        checkExpression(node.value, `${context} set 值`)
        break
      case "if":
        checkExpression(node.condition, `${context} if 条件`)
        if (node.elseIfClauses.length > 0) reasons.add("脚本包含 else-if")
        node.thenBody.forEach((child, index) => visit(child, `${context}.then[${index}]`))
        node.elseIfClauses.forEach((clause, clauseIndex) => {
          checkExpression(clause.condition, `${context}.else-if[${clauseIndex}] 条件`)
          clause.body.forEach((child, index) => visit(child, `${context}.else-if[${clauseIndex}][${index}]`))
        })
        node.elseBody?.forEach((child, index) => visit(child, `${context}.else[${index}]`))
        break
      case "for":
        checkExpression(node.iterable, `${context} for iterable`)
        node.body.forEach((child, index) => visit(child, `${context}.body[${index}]`))
        break
      case "block":
        reasons.add(node.modifier ? `脚本包含 ${node.modifier} modifier` : "脚本包含独立 block")
        node.body.forEach((child, index) => visit(child, `${context}.block[${index}]`))
        break
      case "case":
      case "check":
      case "logic":
      case "math":
      case "flag":
      case "inline":
      case "lazy":
      case "selector":
      case "comment":
      case "error":
        reasons.add(`脚本包含不支持的 ${node.type} 节点`)
        break
      case "script":
        node.body.forEach((child, index) => visit(child, `script[${index}]`))
        break
      case "calc":
      case "var_ref":
      case "lazy_ref":
      case "number":
      case "string":
      case "boolean":
      case "identifier":
        break
    }
  }

  visit(ast, "script")
  return { writable: reasons.size === 0, reasons: [...reasons] }
}

// ============ AST → Flow ============

/** 纯初始化转换：解析与布局不会触发任何文本回调。 */
export function initializeFlowFromText(
  source: string,
  schema: ActionsSchemaV2,
  existingPositions?: Map<string, { x: number; y: number }>
): FlowState {
  const ast = parseKether(source, toParserActionsSchema(schema))
  return astToFlow(ast, schema, existingPositions, source)
}

export function astToFlow(
  ast: ScriptNode,
  schema: ActionsSchemaV2,
  existingPositions?: Map<string, { x: number; y: number }>,
  source = ""
): FlowState {
  nodeIdCounter = 0
  const nodes: KetherNode[] = []
  const edges: KetherEdge[] = []
  const actionMap = buildActionMap(schema)
  const compatibility = analyzeFlowCompatibility(ast, schema, source)

  convertSequence(ast.body, nodes, edges, actionMap, schema, null, {
    scopeId: "script",
    semantic: true,
  })

  for (const node of nodes) {
    node.data.readOnly = !compatibility.writable
    const savedPosition = existingPositions?.get(node.id)
    if (savedPosition) node.position = savedPosition
  }
  return { nodes, edges, readOnlyReasons: compatibility.reasons }
}

interface SequenceContext {
  scopeId: string
  slot?: string
  semantic: boolean
}

function convertSequence(
  statements: ASTNode[],
  nodes: KetherNode[],
  edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>,
  schema: ActionsSchemaV2,
  parentId: string | null,
  context: SequenceContext
): string[] {
  const ids = statements.flatMap((statement) => (
    convertNode(statement, nodes, edges, actionMap, schema, parentId)
  ))

  for (let index = 0; index < ids.length - 1; index += 1) {
    const source = ids[index]
    const target = ids[index + 1]
    edges.push({
      id: `execution:${context.scopeId}:${context.slot ?? "top"}:${index}:${source}->${target}`,
      source,
      sourceHandle: "flow-out",
      target,
      targetHandle: "flow-in",
      data: {
        kind: "execution",
        generated: true,
        semantic: context.semantic,
        scopeId: context.scopeId,
        slot: context.slot,
        order: index,
      },
    })
  }

  return ids
}

function convertNode(
  node: ASTNode,
  nodes: KetherNode[],
  edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>,
  schema: ActionsSchemaV2,
  parentId: string | null
): string[] {
  switch (node.type) {
    case "action_call": return [convertActionCall(node, nodes, actionMap, parentId)]
    case "set": return [convertSet(node, nodes, parentId)]
    case "if": return [convertIf(node, nodes, edges, actionMap, schema, parentId)]
    case "for": return [convertFor(node, nodes, edges, actionMap, schema, parentId)]
    case "var_ref":
    case "lazy_ref":
    case "number":
    case "string":
    case "boolean":
    case "identifier":
      return [convertDataNode(node, nodes, parentId)]
    case "calc": return [convertCalcNode(node, nodes, parentId)]
    case "block":
      return node.body.flatMap((child) => (
        convertNode(child, nodes, edges, actionMap, schema, parentId)
      ))
    default: return []
  }
}

function addStructureEdge(
  edges: KetherEdge[],
  source: string,
  target: string | undefined,
  slot: "then" | "else" | "body"
) {
  if (!target) return
  edges.push({
    id: `structure:${source}:${slot}:${target}`,
    source,
    sourceHandle: `${slot}-out`,
    target,
    targetHandle: "flow-in",
    data: {
      kind: "structure",
      generated: true,
      semantic: false,
      scopeId: source,
      slot,
      order: 0,
    },
  })
}

function convertActionCall(
  node: ActionCallNode,
  nodes: KetherNode[],
  actionMap: Map<string, SchemaAction>,
  parentId: string | null
): string {
  const id = nextId("action")
  const schemaAction = actionMap.get(node.name.toLowerCase()) ?? null
  const inputs: Record<string, unknown> = {}
  const inputKinds: Record<string, KetherInputKind> = {}

  if (schemaAction) {
    const positional = schemaAction.inputs.filter((input) => !input.keyword)
    node.args.forEach((argument, index) => {
      const input = positional[index]
      const extracted = extractFlowValue(argument)
      if (input && extracted) {
        inputs[input.key] = extracted.value
        inputKinds[input.key] = extracted.kind
      }
    })
    for (const [keyword, value] of Object.entries(node.keywordArgs)) {
      const input = schemaAction.inputs.find((candidate) => candidate.keyword?.toLowerCase() === keyword.toLowerCase())
      const extracted = extractFlowValue(value)
      if (input && extracted) {
        inputs[input.key] = extracted.value
        inputKinds[input.key] = extracted.kind
      }
    }
  }

  nodes.push({
    id,
    type: "actionNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: node.name,
      schemaAction,
      inputs,
      inputKinds,
      slotChildren: {},
      nodeKind: "action",
      astRef: node,
    },
  })
  return id
}

function convertSet(node: ASTSetNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("set")
  const extracted = extractFlowValue(node.value)
  nodes.push({
    id,
    type: "setNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: `set ${node.variable}`,
      schemaAction: null,
      inputs: { variable: node.variable, value: extracted?.value ?? "" },
      inputKinds: { variable: "identifier", value: extracted?.kind ?? "string" },
      slotChildren: {},
      nodeKind: "set",
      astRef: node,
    },
  })
  return id
}

function convertIf(
  node: IfNode,
  nodes: KetherNode[],
  edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>,
  schema: ActionsSchemaV2,
  parentId: string | null
): string {
  const id = nextId("branch")
  const condition = extractFlowValue(node.condition)
  const slotChildren: Record<string, string[]> = { then: [], else: [] }

  nodes.push({
    id,
    type: "branchNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: "if",
      schemaAction: null,
      inputs: { condition: condition?.value ?? "" },
      inputKinds: { condition: condition?.kind ?? "identifier" },
      slotChildren,
      nodeKind: "branch",
      astRef: node,
    },
  })

  slotChildren.then = convertSequence(node.thenBody, nodes, edges, actionMap, schema, id, {
    scopeId: id,
    slot: "then",
    semantic: false,
  })
  slotChildren.else = convertSequence(node.elseBody ?? [], nodes, edges, actionMap, schema, id, {
    scopeId: id,
    slot: "else",
    semantic: false,
  })
  addStructureEdge(edges, id, slotChildren.then[0], "then")
  addStructureEdge(edges, id, slotChildren.else[0], "else")
  return id
}

function convertFor(
  node: ForNode,
  nodes: KetherNode[],
  edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>,
  schema: ActionsSchemaV2,
  parentId: string | null
): string {
  const id = nextId("loop")
  const iterable = extractFlowValue(node.iterable)
  const slotChildren: Record<string, string[]> = { body: [] }

  nodes.push({
    id,
    type: "loopNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: `for ${node.variable}`,
      schemaAction: null,
      inputs: { variable: node.variable, iterable: iterable?.value ?? "" },
      inputKinds: { variable: "identifier", iterable: iterable?.kind ?? "identifier" },
      slotChildren,
      nodeKind: "loop",
      astRef: node,
      provides: { [node.variable]: node.variable },
    },
  })

  slotChildren.body = convertSequence(node.body, nodes, edges, actionMap, schema, id, {
    scopeId: id,
    slot: "body",
    semantic: false,
  })
  addStructureEdge(edges, id, slotChildren.body[0], "body")
  return id
}

function convertDataNode(node: ASTNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("data")
  const extracted = extractFlowValue(node)
  const value = extracted?.value ?? ""

  nodes.push({
    id,
    type: "dataNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: String(value),
      schemaAction: null,
      inputs: { value },
      inputKinds: { value: extracted?.kind ?? "string" },
      slotChildren: {},
      nodeKind: "data",
      astRef: node,
    },
  })
  return id
}

function convertCalcNode(node: ASTCalcNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("calc")
  nodes.push({
    id,
    type: "calcNode",
    position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: "calc",
      schemaAction: null,
      inputs: { formula: node.formula },
      inputKinds: { formula: "string" },
      slotChildren: {},
      nodeKind: "calc",
      astRef: node,
    },
  })
  return id
}

function extractFlowValue(node: ASTNode): { value: unknown; kind: KetherInputKind } | null {
  switch (node.type) {
    case "number": return { value: String((node as NumberNode).value), kind: "number" }
    case "string": return { value: (node as StringNode).value, kind: "string" }
    case "boolean": return { value: (node as BooleanNode).value, kind: "boolean" }
    case "identifier": return { value: (node as IdentifierNode).name, kind: "identifier" }
    case "var_ref": {
      const variable = node as VarRefNode
      return { value: variable.key ? `&${variable.name}[${variable.key}]` : `&${variable.name}`, kind: "var_ref" }
    }
    case "lazy_ref": return { value: `*${(node as LazyRefNode).name}`, kind: "lazy_ref" }
    default: return null
  }
}

export function inferInputKind(input: SchemaInput, value: unknown): KetherInputKind {
  const normalizedType = input.type.toLowerCase()
  if (["double", "int", "long", "number"].includes(normalizedType)) return "number"
  if (["boolean", "bool"].includes(normalizedType)) return "boolean"
  if (["string", "text"].includes(normalizedType)) return "string"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  return "identifier"
}

/** 根据受控输入文本推断简单表达式类型，同时保留数值中间态。 */
export function inferEditedInputKind(previous: KetherInputKind | undefined, value: unknown): KetherInputKind {
  if (typeof value === "boolean") return "boolean"
  const text = String(value ?? "")
  if (previous === "string") return "string"
  if (previous === "number" && (text === "" || /^-?(?:\d*(?:\.\d*)?)$/.test(text))) return "number"
  if (text.startsWith("&") && !/\s/.test(text)) return "var_ref"
  if (text.startsWith("*") && !/\s/.test(text)) return "lazy_ref"
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return "number"
  if (/^(true|false)$/i.test(text)) return "boolean"
  if (/\s/.test(text)) return "string"
  return "identifier"
}

// ============ Connection mutation ============

function isMappedInput(node: KetherNode, handle: string): boolean {
  switch (node.data.nodeKind) {
    case "action": return Boolean(node.data.schemaAction?.inputs.some((input) => input.key === handle))
    case "set": return handle === "value"
    case "branch": return handle === "condition"
    case "loop": return handle === "iterable"
    case "calc": return handle === "formula"
    default: return false
  }
}

/** 将连线解析为显式输入 mutation 或顶层执行顺序 mutation。 */
export function applyConnectionToFlow(
  state: FlowState,
  connection: Connection,
  edgeId = `${connection.source ?? "source"}:${connection.sourceHandle ?? "flow"}->${connection.target ?? "target"}:${connection.targetHandle ?? "flow"}`
): FlowConnectionResult {
  if (!connection.source || !connection.target) {
    return { accepted: false, state, reason: "连线缺少源节点或目标节点" }
  }

  const source = state.nodes.find((node) => node.id === connection.source)
  const target = state.nodes.find((node) => node.id === connection.target)
  if (!source || !target) return { accepted: false, state, reason: "连线节点不存在" }

  const executionConnection =
    (!connection.sourceHandle && !connection.targetHandle)
    || (connection.sourceHandle === "flow-out" && connection.targetHandle === "flow-in")
  const touchesExecutionPort = connection.sourceHandle === "flow-out" || connection.targetHandle === "flow-in"

  if (touchesExecutionPort && !executionConnection) {
    return { accepted: false, state, reason: "执行连线必须由 flow-out 连接到 flow-in" }
  }

  if (!executionConnection && connection.targetHandle) {
    if (!isMappedInput(target, connection.targetHandle)) {
      return { accepted: false, state, reason: `目标 handle ${connection.targetHandle} 无法映射到输入` }
    }
    if (source.data.nodeKind !== "data" || connection.sourceHandle !== "output") {
      return { accepted: false, state, reason: "只有数据节点输出可写入参数输入" }
    }

    const value = Object.prototype.hasOwnProperty.call(source.data.inputs, "value")
      ? source.data.inputs.value
      : source.data.inputs.literal
    const kind = source.data.inputKinds.value ?? source.data.inputKinds.literal ?? "string"
    const nodes = state.nodes.map((node) => node.id === target.id ? {
      ...node,
      data: {
        ...node.data,
        inputs: { ...node.data.inputs, [connection.targetHandle as string]: value },
        inputKinds: { ...node.data.inputKinds, [connection.targetHandle as string]: kind },
      },
    } : node)
    const edges = [
      ...state.edges.filter((edge) => !(edge.data?.kind === "data" && edge.target === target.id && edge.targetHandle === connection.targetHandle)),
      {
        ...connection,
        id: edgeId,
        animated: true,
        style: { stroke: "#38bdf8", strokeWidth: 1.5 },
        data: {
          kind: "data" as const,
          sourcePort: connection.sourceHandle ?? undefined,
          targetPort: connection.targetHandle,
        },
      },
    ]
    return { accepted: true, state: { ...state, nodes, edges }, kind: "data" }
  }

  if (!executionConnection) {
    return { accepted: false, state, reason: "连线端口无法识别" }
  }
  if (source.parentId || target.parentId) {
    return { accepted: false, state, reason: "执行连线仅支持顶层节点" }
  }
  if (source.id === target.id) return { accepted: false, state, reason: "执行连线不能连接自身" }

  const edges = [
    ...state.edges.filter((edge) => {
      const generatedTopLevelExecution = edge.data?.kind === "execution"
        && edge.data.generated === true
        && edge.data.semantic === true
      const sameExecutionConnection = isExecutionEdge(edge)
        && edge.source === source.id
        && edge.target === target.id
      return !generatedTopLevelExecution && !sameExecutionConnection
    }),
    {
      ...connection,
      id: edgeId,
      animated: true,
      style: { stroke: "#38bdf8", strokeWidth: 1.5 },
      data: { kind: "execution" as const, generated: false, semantic: true },
    },
  ]
  return { accepted: true, state: { ...state, edges }, kind: "execution" }
}

// ============ Flow → AST ============

export function flowToAst(state: FlowState, schema: ActionsSchemaV2): ScriptNode {
  if ((state.readOnlyReasons?.length ?? 0) > 0) throw new Error("只读 Flow 不允许回写")
  const nodeMap = new Map(state.nodes.map((node) => [node.id, node]))
  const topLevel = sortTopLevelByEdges(state.nodes, state.edges)
  const body = topLevel.map((node) => nodeToAst(node, nodeMap, schema)).filter((node): node is ASTNode => node !== null)
  const position = { offset: 0, line: 1, column: 1 }
  return { type: "script", body, start: position, end: position }
}

function isExecutionEdge(edge: KetherEdge): boolean {
  return edge.data?.kind === "execution" || (!edge.data?.kind && !edge.targetHandle)
}

function isSemanticExecutionEdge(edge: KetherEdge): boolean {
  return isExecutionEdge(edge) && edge.data?.semantic !== false
}

function sortTopLevelByEdges(nodes: KetherNode[], edges: KetherEdge[]): KetherNode[] {
  const dataSourceIds = new Set(
    edges
      .filter((edge) => edge.data?.kind === "data")
      .map((edge) => edge.source)
  )
  const topLevel = nodes.filter((node) => (
    !node.parentId && !(node.data.nodeKind === "data" && dataSourceIds.has(node.id))
  ))
  const executionEdges = edges.filter(isSemanticExecutionEdge)
  if (topLevel.length <= 1 || executionEdges.length === 0) {
    return [...topLevel].sort((left, right) => left.position.y - right.position.y)
  }

  const topIds = new Set(topLevel.map((node) => node.id))
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  for (const node of topLevel) {
    outgoing.set(node.id, [])
    incomingCount.set(node.id, 0)
  }

  for (const edge of executionEdges) {
    if (!topIds.has(edge.source) || !topIds.has(edge.target)) continue
    outgoing.get(edge.source)?.push(edge.target)
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
  }

  const nodeById = new Map(topLevel.map((node) => [node.id, node]))
  const queue = topLevel
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort((left, right) => left.position.y - right.position.y)
    .map((node) => node.id)
  const result: KetherNode[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    queue.sort((leftId, rightId) => {
      const left = nodeById.get(leftId)
      const right = nodeById.get(rightId)
      if (!left || !right) return 0
      return left.position.y - right.position.y || left.position.x - right.position.x
    })
    const id = queue.shift()
    if (!id || visited.has(id)) continue
    visited.add(id)
    const node = nodeById.get(id)
    if (node) result.push(node)

    const targets = outgoing.get(id) ?? []
    targets.sort((leftId, rightId) => {
      const left = nodeById.get(leftId)
      const right = nodeById.get(rightId)
      return left && right ? left.position.y - right.position.y : 0
    })
    for (const targetId of targets) {
      incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) - 1)
      if ((incomingCount.get(targetId) ?? 0) <= 0) queue.push(targetId)
    }
  }

  for (const node of [...topLevel].sort((left, right) => left.position.y - right.position.y)) {
    if (!visited.has(node.id)) result.push(node)
  }
  return result
}

function nodeToAst(node: KetherNode, nodeMap: Map<string, KetherNode>, schema: ActionsSchemaV2): ASTNode | null {
  const position = { offset: 0, line: 1, column: 1 }
  const data = node.data as KetherNodeData

  switch (data.nodeKind) {
    case "action": {
      const args: ASTNode[] = []
      const keywordArgs: Record<string, ASTNode> = {}
      if (data.schemaAction) {
        for (const input of data.schemaAction.inputs.filter((candidate) => !candidate.keyword)) {
          if (!Object.prototype.hasOwnProperty.call(data.inputs, input.key)) continue
          args.push(valueToAst(data.inputs[input.key], data.inputKinds[input.key], position))
        }
        for (const input of data.schemaAction.inputs.filter((candidate) => Boolean(candidate.keyword))) {
          if (!input.keyword || !Object.prototype.hasOwnProperty.call(data.inputs, input.key)) continue
          keywordArgs[input.keyword] = valueToAst(data.inputs[input.key], data.inputKinds[input.key], position)
        }
      }
      return { type: "action_call", name: data.label, args, keywordArgs, start: position, end: position }
    }
    case "set":
      return {
        type: "set",
        variable: requireIdentifier(data.inputs.variable, "变量名"),
        value: valueToAst(data.inputs.value, data.inputKinds.value, position),
        start: position,
        end: position,
      }
    case "branch":
      return {
        type: "if",
        condition: valueToAst(data.inputs.condition, data.inputKinds.condition, position),
        thenBody: getSlotChildren("then", data, nodeMap, schema),
        elseIfClauses: [],
        elseBody: getOptionalSlotChildren("else", data, nodeMap, schema),
        start: position,
        end: position,
      }
    case "loop":
      return {
        type: "for",
        variable: requireIdentifier(data.inputs.variable, "循环变量"),
        iterable: valueToAst(data.inputs.iterable, data.inputKinds.iterable, position),
        body: getSlotChildren("body", data, nodeMap, schema),
        start: position,
        end: position,
      }
    case "data": {
      const valueKey = Object.prototype.hasOwnProperty.call(data.inputs, "value") ? "value" : "literal"
      return valueToAst(data.inputs[valueKey], data.inputKinds[valueKey], position)
    }
    case "calc": return { type: "calc", formula: String(data.inputs.formula ?? ""), start: position, end: position }
    default: return null
  }
}

function getSlotChildren(
  slot: string,
  data: KetherNodeData,
  nodeMap: Map<string, KetherNode>,
  schema: ActionsSchemaV2
): ASTNode[] {
  const ids = data.slotChildren[slot] ?? []
  return ids
    .map((id) => {
      const child = nodeMap.get(id)
      return child ? nodeToAst(child, nodeMap, schema) : null
    })
    .filter((node): node is ASTNode => node !== null)
}

function getOptionalSlotChildren(
  slot: string,
  data: KetherNodeData,
  nodeMap: Map<string, KetherNode>,
  schema: ActionsSchemaV2
): ASTNode[] | null {
  const children = getSlotChildren(slot, data, nodeMap, schema)
  return children.length > 0 ? children : null
}

function requireIdentifier(value: unknown, label: string): string {
  const text = String(value ?? "")
  if (!text || /\s/.test(text)) throw new Error(`${label} 必须是非空单一标识符`)
  return text
}

function valueToAst(
  value: unknown,
  kind: KetherInputKind | undefined,
  position: { offset: number; line: number; column: number }
): ASTNode {
  const resolvedKind = kind ?? (typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string")
  const text = String(value ?? "")

  switch (resolvedKind) {
    case "number":
      if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error(`数值 ${text} 尚未完成`)
      return { type: "number", value: Number(text), start: position, end: position }
    case "boolean": {
      const booleanValue = typeof value === "boolean" ? value : text.toLowerCase() === "true" ? true : text.toLowerCase() === "false" ? false : null
      if (booleanValue === null) throw new Error(`布尔值 ${text} 无效`)
      return { type: "boolean", value: booleanValue, start: position, end: position }
    }
    case "identifier":
      return { type: "identifier", name: requireIdentifier(value, "参数"), start: position, end: position }
    case "var_ref": {
      if (!text.startsWith("&") || /\s/.test(text)) throw new Error(`变量引用 ${text} 无效`)
      const name = text.slice(1)
      const bracketIndex = name.indexOf("[")
      if (bracketIndex !== -1 && name.endsWith("]")) {
        return {
          type: "var_ref",
          name: name.slice(0, bracketIndex),
          key: name.slice(bracketIndex + 1, -1),
          start: position,
          end: position,
        }
      }
      return { type: "var_ref", name, key: null, start: position, end: position }
    }
    case "lazy_ref":
      if (!text.startsWith("*") || /\s/.test(text)) throw new Error(`延迟引用 ${text} 无效`)
      return { type: "lazy_ref", name: text.slice(1), start: position, end: position }
    case "string":
      return { type: "string", value: text, start: position, end: position }
  }
}
