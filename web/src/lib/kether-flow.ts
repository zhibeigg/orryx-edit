import dagre from "@dagrejs/dagre"
import type {
  ASTNode, ScriptNode, ActionCallNode, SetNode as ASTSetNode,
  IfNode, ForNode, CalcNode as ASTCalcNode, VarRefNode,
  NumberNode, StringNode, BooleanNode, IdentifierNode
} from "./kether-ast"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import type { KetherNode, KetherEdge, KetherNodeData, FlowState } from "@/components/editor/flow/flow-types"

let nodeIdCounter = 0
function nextId(prefix: string): string {
  return `${prefix}_${++nodeIdCounter}`
}

// ============ AST → Flow ============

export function astToFlow(
  ast: ScriptNode,
  schema: ActionsSchemaV2,
  existingPositions?: Map<string, { x: number; y: number }>
): FlowState {
  nodeIdCounter = 0
  const nodes: KetherNode[] = []
  const edges: KetherEdge[] = []
  const actionMap = buildActionMap(schema)

  for (const stmt of ast.body) {
    convertNode(stmt, nodes, edges, actionMap, schema, null)
  }

  applyLayout(nodes, edges, existingPositions)
  return { nodes, edges }
}

function buildActionMap(schema: ActionsSchemaV2): Map<string, SchemaAction> {
  const map = new Map<string, SchemaAction>()
  for (const a of schema.actions) {
    map.set(a.name.toLowerCase(), a)
    for (const alias of a.aliases ?? []) map.set(alias.toLowerCase(), a)
  }
  return map
}

function convertNode(
  node: ASTNode,
  nodes: KetherNode[],
  edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>,
  schema: ActionsSchemaV2,
  parentId: string | null
): string | null {
  switch (node.type) {
    case "action_call": return convertActionCall(node, nodes, edges, actionMap, schema, parentId)
    case "set": return convertSet(node, nodes, edges, actionMap, schema, parentId)
    case "if": return convertIf(node, nodes, edges, actionMap, schema, parentId)
    case "for": return convertFor(node, nodes, edges, actionMap, schema, parentId)
    case "var_ref": return convertDataNode(node, nodes, parentId)
    case "number": return convertDataNode(node, nodes, parentId)
    case "string": return convertDataNode(node, nodes, parentId)
    case "boolean": return convertDataNode(node, nodes, parentId)
    case "calc": return convertCalcNode(node, nodes, parentId)
    case "block": {
      for (const child of node.body) {
        convertNode(child, nodes, edges, actionMap, schema, parentId)
      }
      return null
    }
    default: return null
  }
}

function convertActionCall(
  node: ActionCallNode, nodes: KetherNode[], _edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>, _schema: ActionsSchemaV2, parentId: string | null
): string {
  const id = nextId("action")
  const schemaAction = actionMap.get(node.name.toLowerCase()) ?? null
  const inputs: Record<string, unknown> = {}

  if (schemaAction) {
    const positional = schemaAction.inputs.filter(p => !p.keyword)
    node.args.forEach((arg, i) => {
      if (i < positional.length) inputs[positional[i].key] = extractValue(arg)
    })
    for (const [kw, val] of Object.entries(node.keywordArgs)) {
      const param = schemaAction.inputs.find(p => p.keyword?.toLowerCase() === kw.toLowerCase())
      if (param) inputs[param.key] = extractValue(val)
    }
  }

  nodes.push({
    id, type: "actionNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: { label: node.name, schemaAction, inputs, slotChildren: {}, nodeKind: "action", astRef: node }
  })
  return id
}

function convertSet(
  node: ASTSetNode, nodes: KetherNode[], _edges: KetherEdge[],
  _actionMap: Map<string, SchemaAction>, _schema: ActionsSchemaV2, parentId: string | null // eslint-disable-line @typescript-eslint/no-unused-vars
): string {
  const id = nextId("set")
  nodes.push({
    id, type: "setNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: `set ${node.variable}`, schemaAction: null,
      inputs: { variable: node.variable, value: extractValue(node.value) },
      slotChildren: {}, nodeKind: "set", astRef: node
    }
  })
  return id
}

function convertIf(
  node: IfNode, nodes: KetherNode[], edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>, schema: ActionsSchemaV2, parentId: string | null
): string {
  const id = nextId("branch")
  const slotChildren: Record<string, string[]> = { then: [], else: [] }

  for (const child of node.thenBody) {
    const childId = convertNode(child, nodes, edges, actionMap, schema, id)
    if (childId) slotChildren.then.push(childId)
  }
  for (const child of node.elseBody ?? []) {
    const childId = convertNode(child, nodes, edges, actionMap, schema, id)
    if (childId) slotChildren.else.push(childId)
  }

  nodes.push({
    id, type: "branchNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: "if", schemaAction: null,
      inputs: { condition: extractValue(node.condition) },
      slotChildren, nodeKind: "branch", astRef: node
    }
  })
  return id
}

function convertFor(
  node: ForNode, nodes: KetherNode[], edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>, schema: ActionsSchemaV2, parentId: string | null
): string {
  const id = nextId("loop")
  const slotChildren: Record<string, string[]> = { body: [] }

  for (const child of node.body) {
    const childId = convertNode(child, nodes, edges, actionMap, schema, id)
    if (childId) slotChildren.body.push(childId)
  }

  nodes.push({
    id, type: "loopNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: {
      label: `for ${node.variable}`, schemaAction: null,
      inputs: { variable: node.variable, iterable: extractValue(node.iterable) },
      slotChildren, nodeKind: "loop", astRef: node,
      provides: { [node.variable]: node.variable }
    }
  })
  return id
}

function convertDataNode(node: ASTNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("data")
  let label = ""
  let value: unknown = null

  if (node.type === "var_ref") {
    const v = node as VarRefNode
    label = `&${v.name}`
    value = v.key ? `&${v.name}[${v.key}]` : `&${v.name}`
  } else if (node.type === "number") {
    const n = node as NumberNode
    label = String(n.value)
    value = n.value
  } else if (node.type === "string") {
    const s = node as StringNode
    label = `"${s.value}"`
    value = s.value
  } else if (node.type === "boolean") {
    const b = node as BooleanNode
    label = String(b.value)
    value = b.value
  }

  nodes.push({
    id, type: "dataNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: { label, schemaAction: null, inputs: { value }, slotChildren: {}, nodeKind: "data", astRef: node }
  })
  return id
}

function convertCalcNode(node: ASTCalcNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("calc")
  nodes.push({
    id, type: "calcNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: { label: "calc", schemaAction: null, inputs: { formula: node.formula }, slotChildren: {}, nodeKind: "calc", astRef: node }
  })
  return id
}

function extractValue(node: ASTNode): unknown {
  switch (node.type) {
    case "number": return (node as NumberNode).value
    case "string": return (node as StringNode).value
    case "boolean": return (node as BooleanNode).value
    case "identifier": return (node as IdentifierNode).name
    case "var_ref": {
      const v = node as VarRefNode
      return v.key ? `&${v.name}[${v.key}]` : `&${v.name}`
    }
    case "lazy_ref": return `*${(node as { name: string }).name}`
    default: return null
  }
}

// ============ 自动布局 ============

function applyLayout(
  nodes: KetherNode[], edges: KetherEdge[],
  existingPositions?: Map<string, { x: number; y: number }>
) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "TB", nodesep: 20, ranksep: 40 })

  const topLevel = nodes.filter(n => !n.parentId)
  for (const node of topLevel) {
    g.setNode(node.id, { width: 260, height: 80 })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  for (const node of topLevel) {
    const pos = existingPositions?.get(node.id)
    if (pos) {
      node.position = pos
    } else {
      const dagreNode = g.node(node.id)
      if (dagreNode) {
        node.position = { x: dagreNode.x - 130, y: dagreNode.y - 40 }
      }
    }
  }
}

// ============ Flow → AST ============

export function flowToAst(state: FlowState, _schema: ActionsSchemaV2): ScriptNode {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]))
  const topLevel = state.nodes
    .filter(n => !n.parentId)
    .sort((a, b) => a.position.y - b.position.y)

  const body = topLevel.map(n => nodeToAst(n, nodeMap)).filter(Boolean) as ASTNode[]
  const pos = { offset: 0, line: 1, column: 1 }
  return { type: "script", body, start: pos, end: pos }
}

function nodeToAst(node: KetherNode, nodeMap: Map<string, KetherNode>): ASTNode | null {
  const pos = { offset: 0, line: 1, column: 1 }
  const d = node.data as KetherNodeData

  switch (d.nodeKind) {
    case "action": {
      const args = d.schemaAction
        ? d.schemaAction.inputs.filter(p => !p.keyword).map(p => valueToAst(d.inputs[p.key], pos))
        : []
      const keywordArgs: Record<string, ASTNode> = {}
      if (d.schemaAction) {
        for (const p of d.schemaAction.inputs.filter(p => p.keyword)) {
          if (d.inputs[p.key] != null) keywordArgs[p.keyword!] = valueToAst(d.inputs[p.key], pos)
        }
      }
      return { type: "action_call", name: d.label, args, keywordArgs, start: pos, end: pos }
    }
    case "set": {
      return {
        type: "set",
        variable: String(d.inputs.variable ?? "x"),
        value: valueToAst(d.inputs.value, pos),
        start: pos, end: pos
      }
    }
    case "branch": {
      const thenChildren = getSlotChildren("then", d, nodeMap)
      const elseChildren = getSlotChildren("else", d, nodeMap)
      return {
        type: "if",
        condition: valueToAst(d.inputs.condition, pos),
        thenBody: thenChildren,
        elseIfClauses: [],
        elseBody: elseChildren.length > 0 ? elseChildren : null,
        start: pos, end: pos
      }
    }
    case "loop": {
      const bodyChildren = getSlotChildren("body", d, nodeMap)
      return {
        type: "for",
        variable: String(d.inputs.variable ?? "i"),
        iterable: valueToAst(d.inputs.iterable, pos),
        body: bodyChildren,
        start: pos, end: pos
      }
    }
    case "data": return valueToAst(d.inputs.value, pos)
    case "calc": return { type: "calc", formula: String(d.inputs.formula ?? ""), start: pos, end: pos }
    default: return null
  }
}

function getSlotChildren(slot: string, data: KetherNodeData, nodeMap: Map<string, KetherNode>): ASTNode[] {
  const ids = data.slotChildren[slot] ?? []
  return ids.map(id => {
    const child = nodeMap.get(id)
    return child ? nodeToAst(child, nodeMap) : null
  }).filter(Boolean) as ASTNode[]
}

function valueToAst(value: unknown, pos: { offset: number; line: number; column: number }): ASTNode {
  if (typeof value === "number") return { type: "number", value, start: pos, end: pos }
  if (typeof value === "boolean") return { type: "boolean", value, start: pos, end: pos }
  if (typeof value === "string") {
    if (value.startsWith("&")) {
      const name = value.slice(1)
      const bracketIdx = name.indexOf("[")
      if (bracketIdx !== -1 && name.endsWith("]")) {
        return { type: "var_ref", name: name.slice(0, bracketIdx), key: name.slice(bracketIdx + 1, -1), start: pos, end: pos }
      }
      return { type: "var_ref", name, key: null, start: pos, end: pos }
    }
    if (value.startsWith("*")) return { type: "lazy_ref", name: value.slice(1), start: pos, end: pos }
    return { type: "string", value, start: pos, end: pos }
  }
  return { type: "identifier", name: String(value ?? "null"), start: pos, end: pos }
}
