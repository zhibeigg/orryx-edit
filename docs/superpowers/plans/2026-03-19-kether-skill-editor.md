# Kether 技能编辑器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Orryx Editor 添加基于 React Flow 的节点流编辑器和 Monaco 参数向导，实现 Kether 脚本的可视化编辑。

**Architecture:** 共享 AST 中间层连接文本编辑器和节点编辑器，schema v2 驱动节点自动生成。ActionsEditor 在 text/flow 两种模式间切换，双向实时同步。

**Tech Stack:** React 19, TypeScript 5.9, @xyflow/react v12, @dagrejs/dagre, Monaco Editor, Zustand

**Spec:** `docs/superpowers/specs/2026-03-19-kether-skill-editor-design.md`

---

## 文件结构

```
web/src/
├── types/
│   └── schema.ts                      ← 新建：Schema v2 类型定义
├── lib/
│   ├── kether-flow.ts                 ← 新建：AST ↔ Flow 双向转换
│   ├── parameter-wizard.ts            ← 新建：向导生命周期 + 文本插入
│   ├── kether-ast.ts                  ← 保留不动
│   └── kether-language.ts             ← 修改：集成向导触发
├── components/editor/
│   ├── flow/
│   │   ├── FlowEditor.tsx             ← 新建：React Flow 主画布
│   │   ├── FlowMinimap.tsx            ← 新建：缩略图
│   │   ├── NodePalette.tsx            ← 新建：左侧节点面板
│   │   ├── flow-types.ts             ← 新建：Flow 数据模型
│   │   └── nodes/
│   │       ├── ActionNode.tsx         ← 新建：普通 action 节点
│   │       ├── BranchNode.tsx         ← 新建：分支容器 (if/case)
│   │       ├── LoopNode.tsx           ← 新建：循环容器 (for)
│   │       ├── DataNode.tsx           ← 新建：数据节点
│   │       ├── SetNode.tsx            ← 新建：set 变量节点
│   │       ├── CalcNode.tsx           ← 新建：calc 表达式节点
│   │       └── node-styles.ts         ← 新建：节点样式
│   ├── ParameterWizard.tsx            ← 新建：参数向导浮层
│   ├── SelectorBuilder.tsx            ← 新建：选择器构建器
│   ├── ActionsEditor.tsx              ← 修改：text/flow 模式切换
│   ├── KetherBlockEditor.tsx          ← 删除
│   └── blocks/block-styles.ts         ← 删除
```

---

## Task 1: 安装依赖 + Schema v2 类型

**Files:**
- Modify: `web/package.json`
- Create: `web/src/types/schema.ts`

- [ ] **Step 1: 安装 React Flow 和 dagre**

```bash
cd web && npm install @xyflow/react @dagrejs/dagre && npm install -D @types/d3-hierarchy
```

- [ ] **Step 2: 创建 Schema v2 类型定义**

创建 `web/src/types/schema.ts`：

```typescript
// actions-schema.json v2 类型定义

export interface SchemaType {
  widget: "number" | "text" | "toggle" | "select" | "selector" | "vector3" | "location" | "matrix" | "duration" | "port" | "list"
  color: string
  step?: number
}

export interface SchemaCategory {
  color: string
  icon: string
}

export interface SchemaInput {
  name: string
  key: string
  type: string
  required: boolean
  default: unknown
  description?: string
  keyword?: string
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface SchemaOutput {
  type: string
  description?: string
}

export interface SchemaSlot {
  name: string
  label: string
  multiple: boolean
  optional?: boolean
}

export interface SchemaProvide {
  name: string
  key: string
  type: string
  description?: string
}

export type FlowType = "normal" | "branch" | "loop" | "container"

export interface SchemaAction {
  name: string
  aliases?: string[]
  category: string
  namespace: string
  description: string
  example?: string
  builtin?: boolean
  inputs: SchemaInput[]
  output: SchemaOutput | null
  flow: FlowType
  slots?: SchemaSlot[]
  provides?: SchemaProvide[]
}

export interface SchemaSelector {
  name: string
  aliases?: string[]
  description: string
  params: { name: string; key: string; type: string; default?: unknown }[]
}

export interface ActionsSchemaV2 {
  version: 2
  types: Record<string, SchemaType>
  categories: Record<string, SchemaCategory>
  actions: SchemaAction[]
  selectors: SchemaSelector[]
  triggers?: unknown[]
}
```

- [ ] **Step 3: 验证构建**

```bash
cd web && npx tsc -b --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add web/package.json web/package-lock.json web/src/types/schema.ts
git commit -m "feat: add React Flow deps + Schema v2 types"
```

---

## Task 2: Flow 数据模型 + 节点样式

**Files:**
- Create: `web/src/components/editor/flow/flow-types.ts`
- Create: `web/src/components/editor/flow/nodes/node-styles.ts`

- [ ] **Step 1: 创建 Flow 数据模型**

创建 `web/src/components/editor/flow/flow-types.ts`：

```typescript
import type { Node, Edge } from "@xyflow/react"
import type { SchemaAction, SchemaInput, FlowType } from "@/types/schema"
import type { ASTNode } from "@/lib/kether-ast"

export interface KetherNodeData extends Record<string, unknown> {
  label: string
  schemaAction: SchemaAction | null
  inputs: Record<string, unknown>
  slotChildren: Record<string, string[]>
  provides?: Record<string, string>
  astRef?: ASTNode
  nodeKind: "action" | "branch" | "loop" | "data" | "set" | "calc"
}

export interface KetherEdgeData extends Record<string, unknown> {
  sourcePort: string
  targetPort: string
  dataType: string
}

export type KetherNode = Node<KetherNodeData>
export type KetherEdge = Edge<KetherEdgeData>

export interface FlowState {
  nodes: KetherNode[]
  edges: KetherEdge[]
}
```

- [ ] **Step 2: 创建节点样式**

创建 `web/src/components/editor/flow/nodes/node-styles.ts`：

```typescript
import type { SchemaAction, ActionsSchemaV2 } from "@/types/schema"

// 根据 schema category 获取节点颜色
export function getNodeColor(action: SchemaAction, schema: ActionsSchemaV2) {
  const cat = schema.categories[action.category]
  return cat?.color ?? "#6b7280"
}

// 根据 schema type 获取端口颜色
export function getPortColor(typeName: string, schema: ActionsSchemaV2) {
  const t = schema.types[typeName]
  return t?.color ?? "#6b7280"
}

// 节点类型 → 默认颜色（内置节点用）
export const BUILTIN_COLORS: Record<string, string> = {
  set: "#16a34a",
  if: "#ea580c",
  for: "#ea580c",
  case: "#ea580c",
  calc: "#06b6d4",
  data: "#6366f1",
  var_ref: "#16a34a",
  string: "#db2777",
  number: "#6366f1",
  boolean: "#f59e0b",
}
```

- [ ] **Step 3: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/
git commit -m "feat: add flow data types and node styles"
```

---

## Task 3: AST ↔ Flow 双向转换

**Files:**
- Create: `web/src/lib/kether-flow.ts`

这是核心转换模块。分两个方向：`astToFlow`（AST → React Flow 节点/边）和 `flowToAst`（React Flow → AST）。

- [ ] **Step 1: 创建 kether-flow.ts 骨架 + astToFlow**

创建 `web/src/lib/kether-flow.ts`：

```typescript
import dagre from "@dagrejs/dagre"
import type { ASTNode, ScriptNode, ActionCallNode, SetNode, IfNode, ForNode, CaseNode, BlockNode, CheckNode, MathNode, CalcNode, VarRefNode, NumberNode, StringNode, BooleanNode } from "./kether-ast"
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

  // 自动布局（保留已有位置）
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
    case "calc": return convertCalc(node, nodes, parentId)
    case "block": {
      // sync/async 块：转换子节点
      for (const child of node.body) {
        convertNode(child, nodes, edges, actionMap, schema, parentId)
      }
      return null
    }
    default: return null
  }
}

function convertActionCall(
  node: ActionCallNode, nodes: KetherNode[], edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>, schema: ActionsSchemaV2, parentId: string | null
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
  node: SetNode, nodes: KetherNode[], edges: KetherEdge[],
  actionMap: Map<string, SchemaAction>, schema: ActionsSchemaV2, parentId: string | null
): string {
  const id = nextId("set")
  nodes.push({
    id, type: "setNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: { label: `set ${node.variable}`, schemaAction: null, inputs: { variable: node.variable, value: extractValue(node.value) }, slotChildren: {}, nodeKind: "set", astRef: node }
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
    data: { label: "if", schemaAction: null, inputs: { condition: extractValue(node.condition) }, slotChildren, nodeKind: "branch", astRef: node }
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
    data: { label: `for ${node.variable}`, schemaAction: null, inputs: { variable: node.variable, iterable: extractValue(node.iterable) }, slotChildren, nodeKind: "loop", astRef: node, provides: { [node.variable]: node.variable } }
  })
  return id
}

function convertDataNode(node: ASTNode, nodes: KetherNode[], parentId: string | null): string {
  const id = nextId("data")
  let label = ""
  let value: unknown = null
  if (node.type === "var_ref") { label = `&${node.name}`; value = node.name }
  else if (node.type === "number") { label = String(node.value); value = node.value }
  else if (node.type === "string") { label = `"${node.value}"`; value = node.value }
  else if (node.type === "boolean") { label = String(node.value); value = node.value }

  nodes.push({
    id, type: "dataNode", position: { x: 0, y: 0 },
    parentId: parentId ?? undefined,
    data: { label, schemaAction: null, inputs: { value }, slotChildren: {}, nodeKind: "data", astRef: node }
  })
  return id
}

function convertCalc(node: CalcNode, nodes: KetherNode[], parentId: string | null): string {
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
    case "number": return node.value
    case "string": return node.value
    case "boolean": return node.value
    case "identifier": return node.name
    case "var_ref": return `&${node.name}${node.key ? `[${node.key}]` : ""}`
    case "lazy_ref": return `*${node.name}`
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
```

- [ ] **Step 2: 添加 flowToAst 反向转换**

在 `kether-flow.ts` 末尾追加：

```typescript
// ============ Flow → AST ============

import { type ScriptNode as ScriptNodeType } from "./kether-ast"

export function flowToAst(state: FlowState, schema: ActionsSchemaV2): ScriptNodeType {
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
  const d = node.data

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
      return { type: "set", variable: String(d.inputs.variable ?? "x"), value: valueToAst(d.inputs.value, pos), start: pos, end: pos }
    }
    case "branch": {
      const thenChildren = getSlotChildren("then", d, nodeMap)
      const elseChildren = getSlotChildren("else", d, nodeMap)
      return { type: "if", condition: valueToAst(d.inputs.condition, pos), thenBody: thenChildren, elseIfClauses: [], elseBody: elseChildren.length > 0 ? elseChildren : null, start: pos, end: pos }
    }
    case "loop": {
      const bodyChildren = getSlotChildren("body", d, nodeMap)
      return { type: "for", variable: String(d.inputs.variable ?? "i"), iterable: valueToAst(d.inputs.iterable, pos), body: bodyChildren, start: pos, end: pos }
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
```

- [ ] **Step 3: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/lib/kether-flow.ts
git commit -m "feat: add AST ↔ Flow bidirectional conversion"
```

---

## Task 4: ActionNode 组件

**Files:**
- Create: `web/src/components/editor/flow/nodes/ActionNode.tsx`

- [ ] **Step 1: 创建 ActionNode 组件**

创建 `web/src/components/editor/flow/nodes/ActionNode.tsx`：

```tsx
import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import type { ActionsSchemaV2 } from "@/types/schema"
import { getNodeColor, getPortColor } from "./node-styles"

// 内联参数控件
function ParamWidget({ type, value, options, onChange }: {
  type: string; value: unknown; options?: string[]; onChange: (v: unknown) => void
}) {
  switch (type) {
    case "DOUBLE": case "INT":
      return <input type="number" value={Number(value ?? 0)} onChange={e => onChange(+e.target.value)}
        className="w-16 px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white" />
    case "BOOLEAN":
      return <button onClick={() => onChange(!value)}
        className={`px-2 py-0.5 text-[10px] rounded ${value ? "bg-green-600" : "bg-zinc-600"}`}>
        {value ? "开" : "关"}
      </button>
    case "ENUM":
      return <select value={String(value ?? "")} onChange={e => onChange(e.target.value)}
        className="px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white">
        {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    case "STRING":
      return <input type="text" value={String(value ?? "")} onChange={e => onChange(e.target.value)}
        className="w-20 px-1 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white" />
    default:
      return <span className="text-[10px] text-white/50">{String(value ?? "—")}</span>
  }
}

export const ActionNode = memo(function ActionNode({ data, id }: NodeProps) {
  const d = data as KetherNodeData
  const schema = d.schemaAction

  const handleInputChange = useCallback((key: string, value: unknown) => {
    d.inputs[key] = value
    // 触发 flow state 更新由 FlowEditor 统一处理
  }, [d])

  const color = schema ? "#3b82f6" : "#6b7280" // 有 schema 蓝色，无 schema 灰色
  const catColor = color // 实际使用时从 schema.categories 获取

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[200px]" style={{ border: `2px solid ${catColor}` }}>
      {/* 头部 */}
      <div className="px-3 py-1.5 text-[12px] font-medium text-white flex items-center gap-1.5"
        style={{ backgroundColor: catColor }}>
        <span>{d.label}</span>
        {schema && <span className="text-[9px] opacity-70 ml-auto">{schema.category}</span>}
      </div>

      {/* 输入端口 */}
      <div className="bg-[#1e1e1e] px-2 py-1.5 space-y-1.5">
        {schema?.inputs.map((input, i) => (
          <div key={input.key} className="flex items-center gap-1.5 text-[11px]">
            <Handle type="target" position={Position.Left} id={input.key}
              style={{ background: getPortColor(input.type, {} as ActionsSchemaV2), width: 8, height: 8, left: -4 }} />
            <span className="text-white/70 shrink-0">{input.name}</span>
            <div className="ml-auto">
              <ParamWidget type={input.type} value={d.inputs[input.key] ?? input.default}
                options={input.options} onChange={v => handleInputChange(input.key, v)} />
            </div>
          </div>
        )) ?? (
          <div className="text-[11px] text-white/40">未知 action: {d.label}</div>
        )}
      </div>

      {/* 输出端口 */}
      {schema?.output && (
        <Handle type="source" position={Position.Right} id="output"
          style={{ background: getPortColor(schema.output.type, {} as ActionsSchemaV2), width: 8, height: 8, right: -4 }} />
      )}
    </div>
  )
})
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/nodes/ActionNode.tsx
git commit -m "feat: add ActionNode component with inline param controls"
```

---

## Task 5: DataNode + CalcNode + SetNode 组件

**Files:**
- Create: `web/src/components/editor/flow/nodes/DataNode.tsx`
- Create: `web/src/components/editor/flow/nodes/CalcNode.tsx`
- Create: `web/src/components/editor/flow/nodes/SetNode.tsx`

- [ ] **Step 1: 创建 DataNode**

创建 `web/src/components/editor/flow/nodes/DataNode.tsx`：

```tsx
import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { BUILTIN_COLORS } from "./node-styles"

export const DataNode = memo(function DataNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const color = BUILTIN_COLORS[d.astRef?.type ?? "data"] ?? "#6366f1"

  return (
    <div className="rounded px-3 py-1 text-[12px] font-mono text-white shadow-md min-w-[60px] text-center"
      style={{ backgroundColor: color, border: `1px solid ${color}` }}>
      {d.label}
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#fff", width: 6, height: 6, right: -3 }} />
    </div>
  )
})
```

- [ ] **Step 2: 创建 CalcNode**

创建 `web/src/components/editor/flow/nodes/CalcNode.tsx`：

```tsx
import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const CalcNode = memo(function CalcNode({ data }: NodeProps) {
  const d = data as KetherNodeData

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[180px] border-2 border-cyan-600">
      <div className="px-3 py-1 bg-cyan-600 text-[12px] font-medium text-white">calc</div>
      <div className="bg-[#1e1e1e] px-2 py-1.5">
        <input type="text" value={String(d.inputs.formula ?? "")}
          onChange={e => { d.inputs.formula = e.target.value }}
          className="w-full px-1.5 py-0.5 text-[11px] bg-black/30 border border-white/10 rounded text-white font-mono"
          placeholder="表达式..." />
      </div>
      <Handle type="source" position={Position.Right} id="output"
        style={{ background: "#06b6d4", width: 8, height: 8, right: -4 }} />
    </div>
  )
})
```

- [ ] **Step 3: 创建 SetNode**

创建 `web/src/components/editor/flow/nodes/SetNode.tsx`：

```tsx
import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const SetNode = memo(function SetNode({ data }: NodeProps) {
  const d = data as KetherNodeData

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[180px] border-2 border-green-600">
      <div className="px-3 py-1 bg-green-600 text-[12px] font-medium text-white">set</div>
      <div className="bg-[#1e1e1e] px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-white/70">变量名</span>
          <input type="text" value={String(d.inputs.variable ?? "")}
            onChange={e => { d.inputs.variable = e.target.value }}
            className="flex-1 px-1 py-0.5 bg-black/30 border border-white/10 rounded text-white font-mono" />
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Handle type="target" position={Position.Left} id="value"
            style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
          <span className="text-white/70">值</span>
          <input type="text" value={String(d.inputs.value ?? "")}
            onChange={e => { d.inputs.value = e.target.value }}
            className="flex-1 px-1 py-0.5 bg-black/30 border border-white/10 rounded text-white font-mono" />
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 4: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/nodes/DataNode.tsx web/src/components/editor/flow/nodes/CalcNode.tsx web/src/components/editor/flow/nodes/SetNode.tsx
git commit -m "feat: add DataNode, CalcNode, SetNode components"
```

---

## Task 6: BranchNode 容器组件

**Files:**
- Create: `web/src/components/editor/flow/nodes/BranchNode.tsx`

- [ ] **Step 1: 创建 BranchNode**

创建 `web/src/components/editor/flow/nodes/BranchNode.tsx`：

```tsx
import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const BranchNode = memo(function BranchNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const thenCount = d.slotChildren.then?.length ?? 0
  const elseCount = d.slotChildren.else?.length ?? 0

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[260px] border-2 border-orange-600">
      {/* 头部 */}
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>if</span>
        <Handle type="target" position={Position.Left} id="condition"
          style={{ background: "#f59e0b", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70 ml-1">条件: {String(d.inputs.condition ?? "true")}</span>
      </div>

      {/* Then 插槽 */}
      <div className="bg-[#1e1e1e] border-b border-white/10">
        <div className="px-2 py-1 text-[10px] text-green-400 uppercase tracking-wider">成立 ({thenCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-green-900/10 border-l-2 border-green-600 ml-2 mr-2 mb-1 rounded-sm">
          {thenCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
          {/* 子节点由 React Flow 的 parentId 机制自动渲染在此区域 */}
        </div>
      </div>

      {/* Else 插槽 */}
      <div className="bg-[#1e1e1e]">
        <div className="px-2 py-1 text-[10px] text-red-400 uppercase tracking-wider">否则 ({elseCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-red-900/10 border-l-2 border-red-600 ml-2 mr-2 mb-1 rounded-sm">
          {elseCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/nodes/BranchNode.tsx
git commit -m "feat: add BranchNode container component"
```

---

## Task 7: LoopNode 容器组件

**Files:**
- Create: `web/src/components/editor/flow/nodes/LoopNode.tsx`

- [ ] **Step 1: 创建 LoopNode**

创建 `web/src/components/editor/flow/nodes/LoopNode.tsx`：

```tsx
import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"

export const LoopNode = memo(function LoopNode({ data }: NodeProps) {
  const d = data as KetherNodeData
  const bodyCount = d.slotChildren.body?.length ?? 0

  return (
    <div className="rounded-lg overflow-hidden shadow-lg min-w-[260px] border-2 border-orange-600">
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>for</span>
        <input type="text" value={String(d.inputs.variable ?? "i")}
          onChange={e => { d.inputs.variable = e.target.value }}
          className="w-12 px-1 py-0 text-[11px] bg-black/30 border border-white/10 rounded text-white font-mono" />
        <span className="text-[10px] opacity-70">in</span>
        <Handle type="target" position={Position.Left} id="iterable"
          style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70">{String(d.inputs.iterable ?? "")}</span>
      </div>

      {/* provides 变量提示 */}
      {d.provides && Object.keys(d.provides).length > 0 && (
        <div className="bg-[#252526] px-2 py-0.5 text-[9px] text-green-400 border-b border-white/10">
          可用变量: {Object.keys(d.provides).map(k => `&${k}`).join(", ")}
        </div>
      )}

      {/* 循环体插槽 */}
      <div className="bg-[#1e1e1e]">
        <div className="px-2 py-1 text-[10px] text-orange-400 uppercase tracking-wider">循环体 ({bodyCount})</div>
        <div className="min-h-[40px] px-2 py-1 bg-orange-900/10 border-l-2 border-orange-600 ml-2 mr-2 mb-1 rounded-sm">
          {bodyCount === 0 && <div className="text-[10px] text-white/30 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/nodes/LoopNode.tsx
git commit -m "feat: add LoopNode container component"
```

---

## Task 8: NodePalette 节点面板

**Files:**
- Create: `web/src/components/editor/flow/NodePalette.tsx`

- [ ] **Step 1: 创建 NodePalette**

创建 `web/src/components/editor/flow/NodePalette.tsx`：

```tsx
import { useState, useMemo, useCallback } from "react"
import { ChevronDown, ChevronRight, Search, GripVertical } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"

interface NodePaletteProps {
  schema: ActionsSchemaV2
  onDragStart: (action: SchemaAction | { builtin: string }) => void
}

// 内置控制流节点
const BUILTIN_NODES = [
  { builtin: "set", label: "set 变量", description: "设置变量值" },
  { builtin: "if", label: "if 条件", description: "条件分支" },
  { builtin: "for", label: "for 循环", description: "遍历循环" },
  { builtin: "case", label: "case 匹配", description: "模式匹配" },
  { builtin: "calc", label: "calc 公式", description: "表达式计算" },
]

export function NodePalette({ schema, onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("")
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  const categories = useMemo(() => {
    const cats = new Map<string, SchemaAction[]>()
    for (const action of schema.actions) {
      const cat = action.category
      if (!cats.has(cat)) cats.set(cat, [])
      cats.get(cat)!.push(action)
    }
    return cats
  }, [schema])

  const filtered = useMemo(() => {
    if (!search) return categories
    const q = search.toLowerCase()
    const result = new Map<string, SchemaAction[]>()
    for (const [cat, actions] of categories) {
      const matched = actions.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.aliases ?? []).some(al => al.toLowerCase().includes(q)) ||
        a.description.toLowerCase().includes(q)
      )
      if (matched.length > 0) result.set(cat, matched)
    }
    return result
  }, [categories, search])

  const handleDragStart = useCallback((e: React.DragEvent, action: SchemaAction | { builtin: string }) => {
    e.dataTransfer.setData("application/kether-node", JSON.stringify(action))
    e.dataTransfer.effectAllowed = "move"
    onDragStart(action)
  }, [onDragStart])

  return (
    <div className="w-52 border-r border-[#3c3c3c] flex flex-col bg-[#252526] shrink-0 select-none">
      <div className="p-1.5 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-1 px-2 py-1 bg-[#3c3c3c] rounded">
          <Search className="w-3 h-3 text-[#858585]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索节点..." className="flex-1 text-[11px] bg-transparent border-none text-[#cccccc] focus:outline-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 内置控制流 */}
        <div>
          <button onClick={() => setExpandedCat(expandedCat === "$builtin" ? null : "$builtin")}
            className="w-full px-2 py-1.5 text-[11px] font-semibold text-[#858585] uppercase tracking-wider hover:bg-[#2a2d2e] flex items-center gap-1">
            {expandedCat === "$builtin" ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            控制流
          </button>
          {expandedCat === "$builtin" && BUILTIN_NODES.map(node => (
            <div key={node.builtin} draggable
              onDragStart={e => handleDragStart(e, node)}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e] cursor-grab">
              <GripVertical className="w-3 h-3 text-[#858585]" />
              <span>{node.label}</span>
            </div>
          ))}
        </div>

        {/* Schema actions 按分类 */}
        {[...filtered].map(([cat, actions]) => (
          <div key={cat}>
            <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
              className="w-full px-2 py-1.5 text-[11px] font-semibold text-[#858585] uppercase tracking-wider hover:bg-[#2a2d2e] flex items-center gap-1">
              {expandedCat === cat ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span style={{ color: schema.categories[cat]?.color }}>{cat}</span>
              <span className="text-[9px] opacity-50 ml-auto">{actions.length}</span>
            </button>
            {expandedCat === cat && actions.map(action => (
              <div key={action.name} draggable
                onDragStart={e => handleDragStart(e, action)}
                className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-[#cccccc] hover:bg-[#2a2d2e] cursor-grab"
                title={action.description}>
                <GripVertical className="w-3 h-3 text-[#858585]" />
                <span>{action.name}</span>
                <span className="text-[9px] text-[#858585] ml-auto truncate max-w-[60px]">{action.description}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/NodePalette.tsx
git commit -m "feat: add NodePalette with categories and drag support"
```

---

## Task 9: FlowEditor 主画布

**Files:**
- Create: `web/src/components/editor/flow/FlowEditor.tsx`

- [ ] **Step 1: 创建 FlowEditor**

创建 `web/src/components/editor/flow/FlowEditor.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Connection, type OnConnect, type NodeTypes
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import type { KetherNode, KetherEdge } from "./flow-types"
import { astToFlow, flowToAst } from "@/lib/kether-flow"
import { parseKether, stringifyKether, type ScriptNode } from "@/lib/kether-ast"
import { NodePalette } from "./NodePalette"
import { ActionNode } from "./nodes/ActionNode"
import { DataNode } from "./nodes/DataNode"
import { CalcNode } from "./nodes/CalcNode"
import { SetNode } from "./nodes/SetNode"
import { BranchNode } from "./nodes/BranchNode"
import { LoopNode } from "./nodes/LoopNode"

const nodeTypes: NodeTypes = {
  actionNode: ActionNode,
  dataNode: DataNode,
  calcNode: CalcNode,
  setNode: SetNode,
  branchNode: BranchNode,
  loopNode: LoopNode,
}

interface FlowEditorProps {
  value: string
  onChange: (value: string) => void
  schema: ActionsSchemaV2
}

export function FlowEditor({ value, onChange, schema }: FlowEditorProps) {
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())

  // AST → Flow
  const initialFlow = useMemo(() => {
    try {
      const ast = parseKether(value, schema as any)
      return astToFlow(ast, schema, positionsRef.current)
    } catch {
      return { nodes: [], edges: [] }
    }
  }, [value, schema])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges)

  // 外部文本变更 → 同步到节点图（300ms 防抖）
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      try {
        const ast = parseKether(value, schema as any)
        const flow = astToFlow(ast, schema, positionsRef.current)
        setNodes(flow.nodes)
        setEdges(flow.edges)
      } catch { /* 解析失败时保持当前状态 */ }
    }, 300)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [value, schema, setNodes, setEdges])

  // 连线
  const onConnect: OnConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({
      ...conn,
      data: { sourcePort: conn.sourceHandle ?? "", targetPort: conn.targetHandle ?? "", dataType: "ANY" }
    }, eds))
  }, [setEdges])

  // 节点变更 → 同步文本
  const syncToText = useCallback(() => {
    // 保存当前位置
    for (const node of nodes) {
      positionsRef.current.set(node.id, { ...node.position })
    }
    try {
      const ast = flowToAst({ nodes, edges }, schema)
      const text = stringifyKether(ast)
      onChange(text)
    } catch { /* 忽略转换错误 */ }
  }, [nodes, edges, schema, onChange])

  // 拖放创建节点
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const data = event.dataTransfer.getData("application/kether-node")
    if (!data) return

    const parsed = JSON.parse(data)
    const reactFlowBounds = event.currentTarget.getBoundingClientRect()
    const position = {
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    }

    // 根据拖入的数据创建对应节点
    let newNode: KetherNode
    if ("builtin" in parsed) {
      const kind = parsed.builtin as string
      const nodeKind = kind === "if" || kind === "case" ? "branch" : kind === "for" ? "loop" : kind === "calc" ? "calc" : kind === "set" ? "set" : "action"
      const nodeType = kind === "if" || kind === "case" ? "branchNode" : kind === "for" ? "loopNode" : kind === "calc" ? "calcNode" : kind === "set" ? "setNode" : "actionNode"
      newNode = {
        id: `${kind}_${Date.now()}`, type: nodeType, position,
        data: { label: kind, schemaAction: null, inputs: {}, slotChildren: {}, nodeKind }
      }
    } else {
      const action = parsed as SchemaAction
      const inputs: Record<string, unknown> = {}
      for (const p of action.inputs) {
        if (p.default != null) inputs[p.key] = p.default
      }
      newNode = {
        id: `${action.name}_${Date.now()}`, type: "actionNode", position,
        data: { label: action.name, schemaAction: action, inputs, slotChildren: {}, nodeKind: "action" }
      }
    }

    setNodes(nds => [...nds, newNode])
  }, [setNodes])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  return (
    <div className="flex h-full">
      <NodePalette schema={schema} onDragStart={() => {}} />
      <div className="flex-1">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={syncToText}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          className="bg-[#1e1e1e]"
        >
          <Background color="#333" gap={20} />
          <Controls />
          <MiniMap nodeColor={() => "#3b82f6"} style={{ background: "#252526" }} />
        </ReactFlow>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/flow/FlowEditor.tsx
git commit -m "feat: add FlowEditor with React Flow canvas, drag-drop, sync"
```

---

## Task 10: ActionsEditor 集成

**Files:**
- Modify: `web/src/components/editor/ActionsEditor.tsx`

- [ ] **Step 1: 改造 ActionsEditor 支持 text/flow 模式切换**

替换 `web/src/components/editor/ActionsEditor.tsx` 中的 blocks 模式为 flow 模式：

```tsx
import { useRef, useEffect, useState, lazy, Suspense, useMemo } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, loadActionsSchema, KETHER_LANGUAGE_ID, getActionsSchema } from "@/lib/kether-language"
import { Code, Workflow } from "lucide-react"
import type { ActionsSchemaV2 } from "@/types/schema"
import { parseKether, stringifyKether } from "@/lib/kether-ast"

const FlowEditor = lazy(() => import("./flow/FlowEditor").then(m => ({ default: m.FlowEditor })))

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [mode, setMode] = useState<"text" | "flow">("text")

  // 共享 AST 状态用于模式切换时不重新解析
  const astRef = useRef((() => {
    try { return parseKether(value) } catch { return null }
  })())

  const schema = useMemo(() => getActionsSchema() as ActionsSchemaV2 | null, [])

  const handleMount: OnMount = async (editor, monaco) => {
    editorRef.current = editor
    if (!ketherRegistered) {
      await loadActionsSchema()
      registerKetherLanguage(monaco)
      ketherRegistered = true
    }
    monaco.editor.setTheme("kether-dark")
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, KETHER_LANGUAGE_ID)
  }

  useEffect(() => { return () => { editorRef.current = null } }, [])

  return (
    <div style={{ height }} className="flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
        <button onClick={() => setMode("text")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${mode === "text" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}>
          <Code className="w-3 h-3" />文本
        </button>
        <button onClick={() => setMode("flow")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${mode === "flow" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}>
          <Workflow className="w-3 h-3" />节点
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {mode === "text" ? (
          <Editor height="100%" defaultLanguage="plaintext" value={value}
            onChange={v => onChange(v ?? "")} theme="vs-dark" onMount={handleMount}
            options={{
              fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false },
              lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on",
              tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 },
              bracketPairColorization: { enabled: true }, guides: { bracketPairs: true },
              unicodeHighlight: { ambiguousCharacters: false }, wordBasedSuggestions: "currentDocument",
            }} />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-[13px] text-[#858585]">加载节点编辑器...</div>}>
            {schema && <FlowEditor value={value} onChange={onChange} schema={schema} />}
            {!schema && <div className="flex items-center justify-center h-full text-[13px] text-[#858585]">Schema 未加载</div>}
          </Suspense>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/ActionsEditor.tsx
git commit -m "feat: integrate FlowEditor into ActionsEditor with mode switch"
```

---

## Task 11: ParameterWizard 参数向导

**Files:**
- Create: `web/src/components/editor/ParameterWizard.tsx`
- Create: `web/src/lib/parameter-wizard.ts`

- [ ] **Step 1: 创建参数向导核心逻辑**

创建 `web/src/lib/parameter-wizard.ts`：

```typescript
import type { ActionsSchemaV2, SchemaAction, SchemaInput } from "@/types/schema"

export interface WizardState {
  action: SchemaAction
  values: Record<string, unknown>
  position: { lineNumber: number; column: number }
  isEditing: boolean // true = 编辑已有 action, false = 新插入
}

// 从 schema 查找 action
export function findAction(name: string, schema: ActionsSchemaV2): SchemaAction | null {
  const lower = name.toLowerCase()
  return schema.actions.find(a =>
    a.name.toLowerCase() === lower || (a.aliases ?? []).some(al => al.toLowerCase() === lower)
  ) ?? null
}

// 生成 Kether 文本
export function generateKetherText(action: SchemaAction, values: Record<string, unknown>): string {
  const parts: string[] = [action.name]

  // 位置参数
  for (const input of action.inputs.filter(p => !p.keyword)) {
    const val = values[input.key]
    if (val == null && !input.required) continue
    parts.push(formatValue(val, input))
  }

  // 关键字参数
  for (const input of action.inputs.filter(p => p.keyword)) {
    const val = values[input.key]
    if (val == null || val === input.default) continue
    parts.push(input.keyword!)
    parts.push(formatValue(val, input))
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

// 解析当前行已有的 action 参数（用于编辑模式回填）
export function parseLineValues(line: string, action: SchemaAction): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  // 简化实现：按空格分割，跳过 action 名，按顺序填入位置参数
  const tokens = tokenizeLine(line)
  if (tokens.length === 0) return values

  tokens.shift() // 跳过 action 名
  const positional = action.inputs.filter(p => !p.keyword)
  let posIdx = 0

  let i = 0
  while (i < tokens.length) {
    const kw = action.inputs.find(p => p.keyword?.toLowerCase() === tokens[i].toLowerCase())
    if (kw) {
      i++
      if (i < tokens.length) { values[kw.key] = tokens[i]; i++ }
    } else if (posIdx < positional.length) {
      values[positional[posIdx].key] = tokens[i]
      posIdx++; i++
    } else { i++ }
  }
  return values
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
    } else {
      let s = ""
      while (i < line.length && line[i] !== " " && line[i] !== "\t") { s += line[i]; i++ }
      tokens.push(s)
    }
  }
  return tokens
}
```

- [ ] **Step 2: 创建 ParameterWizard 组件**

创建 `web/src/components/editor/ParameterWizard.tsx`：

```tsx
import { useState, useMemo, useCallback } from "react"
import type { SchemaAction, ActionsSchemaV2 } from "@/types/schema"
import { generateKetherText } from "@/lib/parameter-wizard"
import { X, ChevronDown } from "lucide-react"

interface ParameterWizardProps {
  action: SchemaAction
  schema: ActionsSchemaV2
  initialValues: Record<string, unknown>
  onInsert: (text: string) => void
  onCancel: () => void
}

export function ParameterWizard({ action, schema, initialValues, onInsert, onCancel }: ParameterWizardProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [showOptional, setShowOptional] = useState(false)

  const required = useMemo(() => action.inputs.filter(p => p.required), [action])
  const optional = useMemo(() => action.inputs.filter(p => !p.required), [action])

  const preview = useMemo(() => generateKetherText(action, values), [action, values])

  const updateValue = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const renderWidget = (input: typeof action.inputs[0]) => {
    const val = values[input.key] ?? input.default
    const typeInfo = schema.types[input.type]
    const widget = typeInfo?.widget ?? "text"

    switch (widget) {
      case "number":
        return <input type="number" value={Number(val ?? 0)} onChange={e => updateValue(input.key, +e.target.value)}
          min={input.min} max={input.max} step={input.step ?? typeInfo?.step}
          className="w-20 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white" />
      case "toggle":
        return <button onClick={() => updateValue(input.key, !val)}
          className={`px-2 py-0.5 text-[11px] rounded ${val ? "bg-green-600 text-white" : "bg-[#3c3c3c] text-[#858585]"}`}>
          {val ? "开启" : "关闭"}
        </button>
      case "select":
        return <select value={String(val ?? "")} onChange={e => updateValue(input.key, e.target.value)}
          className="px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white">
          {(input.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      case "selector":
        return <input type="text" value={String(val ?? "")} onChange={e => updateValue(input.key, e.target.value)}
          placeholder="@range 5 !@self"
          className="w-32 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white font-mono" />
      default:
        return <input type="text" value={String(val ?? "")} onChange={e => updateValue(input.key, e.target.value)}
          className="w-24 px-1.5 py-0.5 text-[12px] bg-[#3c3c3c] border border-[#555] rounded text-white" />
    }
  }

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[360px] text-[#cccccc]">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-white">{action.name}</span>
          <span className="text-[10px] text-[#858585]">{action.category}</span>
        </div>
        <button onClick={onCancel} className="p-0.5 hover:bg-[#3c3c3c] rounded"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* 必填参数 */}
      <div className="px-3 py-2 space-y-2">
        {required.map(input => (
          <div key={input.key} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#cccccc] shrink-0">{input.name}</span>
            {renderWidget(input)}
            <span className="text-[9px] text-[#858585] shrink-0">{input.type}</span>
          </div>
        ))}
      </div>

      {/* 可选参数 */}
      {optional.length > 0 && (
        <div className="border-t border-[#3c3c3c]">
          <button onClick={() => setShowOptional(!showOptional)}
            className="w-full px-3 py-1 text-[10px] text-[#858585] hover:bg-[#2a2d2e] flex items-center gap-1">
            <ChevronDown className={`w-3 h-3 transition-transform ${showOptional ? "" : "-rotate-90"}`} />
            可选参数 ({optional.length})
          </button>
          {showOptional && (
            <div className="px-3 py-2 space-y-2">
              {optional.map(input => (
                <div key={input.key} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#cccccc] shrink-0">{input.name}</span>
                  {renderWidget(input)}
                  <span className="text-[9px] text-[#858585] shrink-0">{input.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 预览 + 操作 */}
      <div className="border-t border-[#3c3c3c] px-3 py-2">
        <div className="text-[10px] text-[#858585] mb-1">预览:</div>
        <div className="text-[11px] font-mono bg-[#1e1e1e] px-2 py-1 rounded mb-2 break-all">{preview}</div>
        <div className="flex gap-2">
          <button onClick={() => onInsert(preview)}
            className="px-3 py-1 text-[11px] bg-[#007acc] text-white rounded hover:bg-[#006bb3]">插入</button>
          <button onClick={onCancel}
            className="px-3 py-1 text-[11px] bg-[#3c3c3c] text-[#cccccc] rounded hover:bg-[#4c4c4c]">取消</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/lib/parameter-wizard.ts web/src/components/editor/ParameterWizard.tsx
git commit -m "feat: add ParameterWizard with schema-driven form and preview"
```

---

## Task 12: SelectorBuilder 选择器构建器

**Files:**
- Create: `web/src/components/editor/SelectorBuilder.tsx`

- [ ] **Step 1: 创建 SelectorBuilder**

创建 `web/src/components/editor/SelectorBuilder.tsx`：

```tsx
import { useState, useMemo, useCallback } from "react"
import type { ActionsSchemaV2, SchemaSelector } from "@/types/schema"
import { X, Plus } from "lucide-react"

interface SelectorEntry {
  selector: SchemaSelector
  negated: boolean
  params: Record<string, unknown>
}

interface SelectorBuilderProps {
  schema: ActionsSchemaV2
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function SelectorBuilder({ schema, value, onChange, onClose }: SelectorBuilderProps) {
  const [entries, setEntries] = useState<SelectorEntry[]>(() => parseSelector(value, schema))

  const preview = useMemo(() => {
    return entries.map(e => {
      const prefix = e.negated ? "!@" : "@"
      const args = e.selector.params.map(p => String(e.params[p.key] ?? p.default ?? "")).join(" ")
      return args ? `${prefix}${e.selector.name} ${args}` : `${prefix}${e.selector.name}`
    }).join(" ")
  }, [entries])

  const addSelector = useCallback((sel: SchemaSelector) => {
    const params: Record<string, unknown> = {}
    for (const p of sel.params) { if (p.default != null) params[p.key] = p.default }
    setEntries(prev => [...prev, { selector: sel, negated: false, params }])
  }, [])

  const removeEntry = useCallback((idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const toggleNegate = useCallback((idx: number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, negated: !e.negated } : e))
  }, [])

  const updateParam = useCallback((idx: number, key: string, val: unknown) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, params: { ...e.params, [key]: val } } : e))
  }, [])

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[300px] text-[#cccccc]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <span className="text-[12px] font-medium text-white">选择器构建器</span>
        <button onClick={onClose} className="p-0.5 hover:bg-[#3c3c3c] rounded"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* 可用选择器按钮 */}
      <div className="px-3 py-1.5 flex flex-wrap gap-1 border-b border-[#3c3c3c]">
        {schema.selectors.map(sel => (
          <button key={sel.name} onClick={() => addSelector(sel)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-[#3c3c3c] hover:bg-[#4c4c4c] rounded text-[#cccccc]">
            <Plus className="w-2.5 h-2.5" />@{sel.name}
          </button>
        ))}
      </div>

      {/* 已选择的选择器 */}
      <div className="px-3 py-2 space-y-2 max-h-[200px] overflow-y-auto">
        {entries.map((entry, idx) => (
          <div key={idx} className="flex items-start gap-1.5 bg-[#1e1e1e] rounded px-2 py-1.5">
            <button onClick={() => toggleNegate(idx)}
              className={`text-[10px] px-1 rounded shrink-0 mt-0.5 ${entry.negated ? "bg-red-600 text-white" : "bg-[#3c3c3c] text-[#cccccc]"}`}>
              {entry.negated ? "!" : ""}@{entry.selector.name}
            </button>
            <div className="flex-1 space-y-1">
              {entry.selector.params.map(p => (
                <div key={p.key} className="flex items-center gap-1 text-[10px]">
                  <span className="text-[#858585]">{p.name}:</span>
                  <input type={p.type === "DOUBLE" || p.type === "INT" ? "number" : "text"}
                    value={String(entry.params[p.key] ?? "")}
                    onChange={e => updateParam(idx, p.key, p.type === "DOUBLE" ? +e.target.value : e.target.value)}
                    className="w-14 px-1 py-0 bg-black/30 border border-white/10 rounded text-white" />
                </div>
              ))}
            </div>
            <button onClick={() => removeEntry(idx)} className="p-0.5 hover:bg-[#3c3c3c] rounded shrink-0">
              <X className="w-3 h-3 text-red-400" />
            </button>
          </div>
        ))}
        {entries.length === 0 && <div className="text-[10px] text-[#858585] text-center py-2">点击上方按钮添加选择器</div>}
      </div>

      {/* 预览 + 确定 */}
      <div className="border-t border-[#3c3c3c] px-3 py-2">
        <div className="text-[10px] text-[#858585] mb-1">预览:</div>
        <div className="text-[11px] font-mono bg-[#1e1e1e] px-2 py-1 rounded mb-2">"{preview}"</div>
        <button onClick={() => { onChange(preview); onClose() }}
          className="px-3 py-1 text-[11px] bg-[#007acc] text-white rounded hover:bg-[#006bb3]">确定</button>
      </div>
    </div>
  )
}

// 解析已有选择器字符串
function parseSelector(value: string, schema: ActionsSchemaV2): SelectorEntry[] {
  if (!value) return []
  const entries: SelectorEntry[] = []
  const parts = value.replace(/^"|"$/g, "").split(/\s+/)
  let i = 0
  while (i < parts.length) {
    let part = parts[i]
    let negated = false
    if (part.startsWith("!@")) { negated = true; part = part.slice(2) }
    else if (part.startsWith("@")) { part = part.slice(1) }
    else { i++; continue }

    const sel = schema.selectors.find(s => s.name === part || (s.aliases ?? []).includes(part))
    if (sel) {
      const params: Record<string, unknown> = {}
      for (const p of sel.params) {
        i++
        if (i < parts.length && !parts[i].startsWith("@") && !parts[i].startsWith("!@")) {
          params[p.key] = p.type === "DOUBLE" ? parseFloat(parts[i]) : parts[i]
        } else { i--; break }
      }
      entries.push({ selector: sel, negated, params })
    }
    i++
  }
  return entries
}
```

- [ ] **Step 2: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/editor/SelectorBuilder.tsx
git commit -m "feat: add SelectorBuilder with dynamic selector composition"
```

---

## Task 13: 撤销/重做 + 清理旧代码

**Files:**
- Modify: `web/src/components/editor/flow/FlowEditor.tsx` (添加 undo/redo)
- Delete: `web/src/components/editor/KetherBlockEditor.tsx`
- Delete: `web/src/components/editor/blocks/block-styles.ts`

- [ ] **Step 1: 在 FlowEditor 中添加 AST 快照撤销栈**

在 `FlowEditor.tsx` 中添加：

```typescript
// 在 FlowEditor 组件内部添加
const undoStack = useRef<string[]>([])
const redoStack = useRef<string[]>([])

const pushUndo = useCallback((text: string) => {
  undoStack.current.push(text)
  if (undoStack.current.length > 50) undoStack.current.shift()
  redoStack.current = []
}, [])

const handleUndo = useCallback(() => {
  if (undoStack.current.length === 0) return
  redoStack.current.push(value)
  const prev = undoStack.current.pop()!
  onChange(prev)
}, [value, onChange])

const handleRedo = useCallback(() => {
  if (redoStack.current.length === 0) return
  undoStack.current.push(value)
  const next = redoStack.current.pop()!
  onChange(next)
}, [value, onChange])

// 在 ReactFlow 上添加键盘事件
const onKeyDown = useCallback((e: React.KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault()
    if (e.shiftKey) handleRedo()
    else handleUndo()
  }
}, [handleUndo, handleRedo])
```

- [ ] **Step 2: 删除旧的积木编辑器**

```bash
rm web/src/components/editor/KetherBlockEditor.tsx
rm web/src/components/editor/blocks/block-styles.ts
rmdir web/src/components/editor/blocks 2>/dev/null || true
```

- [ ] **Step 3: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add -A
git commit -m "feat: add undo/redo, remove old block editor"
```

---

## Task 14: Monaco 参数向导集成

**Files:**
- Modify: `web/src/lib/kether-language.ts` (添加向导触发逻辑)
- Modify: `web/src/components/editor/ActionsEditor.tsx` (挂载向导 overlay)

- [ ] **Step 1: 在 kether-language.ts 中添加向导触发 hook**

在 `kether-language.ts` 的 `registerKetherLanguage` 函数中，注册 CompletionItem 的 `command` 回调，当用户从补全列表选中 action 时触发向导：

```typescript
// 在 registerKetherLanguage 中追加
// 注册 CodeLens provider（action 名称左侧显示向导图标）
monaco.languages.registerCodeLensProvider(KETHER_LANGUAGE_ID, {
  provideCodeLenses(model) {
    const lenses: monaco.languages.CodeLens[] = []
    const schema = getActionsSchema() as ActionsSchemaV2 | null
    if (!schema) return { lenses, dispose: () => {} }

    const actionNames = new Set(schema.actions.flatMap(a => [a.name, ...(a.aliases ?? [])]))
    for (let i = 1; i <= model.getLineCount(); i++) {
      const line = model.getLineContent(i).trim()
      const firstToken = line.split(/\s+/)[0]
      if (firstToken && actionNames.has(firstToken.toLowerCase())) {
        lenses.push({
          range: { startLineNumber: i, startColumn: 1, endLineNumber: i, endColumn: 1 },
          command: { id: "kether.openWizard", title: "⚙ 参数向导", arguments: [i, firstToken] }
        })
      }
    }
    return { lenses, dispose: () => {} }
  }
})

// 导出向导触发事件（供 ActionsEditor 监听）
export type WizardTrigger = { lineNumber: number; actionName: string }
export const wizardTriggerCallbacks: ((trigger: WizardTrigger) => void)[] = []

export function onWizardTrigger(cb: (trigger: WizardTrigger) => void) {
  wizardTriggerCallbacks.push(cb)
  return () => { const idx = wizardTriggerCallbacks.indexOf(cb); if (idx >= 0) wizardTriggerCallbacks.splice(idx, 1) }
}
```

- [ ] **Step 2: 在 ActionsEditor 中挂载 ParameterWizard overlay**

在 `ActionsEditor.tsx` 的文本模式中，监听向导触发事件，显示 ParameterWizard 浮层：

```tsx
// 在 ActionsEditor 组件中添加
import { ParameterWizard } from "./ParameterWizard"
import { findAction, parseLineValues } from "@/lib/parameter-wizard"
import { onWizardTrigger, type WizardTrigger } from "@/lib/kether-language"

// state
const [wizardState, setWizardState] = useState<{
  action: SchemaAction; values: Record<string, unknown>; lineNumber: number
} | null>(null)

// 监听向导触发
useEffect(() => {
  if (!schema) return
  const unsub = onWizardTrigger((trigger: WizardTrigger) => {
    const action = findAction(trigger.actionName, schema)
    if (!action) return
    const editor = editorRef.current
    if (!editor) return
    const line = editor.getModel()?.getLineContent(trigger.lineNumber) ?? ""
    const values = parseLineValues(line, action)
    setWizardState({ action, values, lineNumber: trigger.lineNumber })
  })
  return unsub
}, [schema])

// Ctrl+Shift+Space 手动触发
useEffect(() => {
  const editor = editorRef.current
  if (!editor || !schema) return
  const disposable = editor.addAction({
    id: "kether.openWizard",
    label: "打开参数向导",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space],
    run: (ed) => {
      const pos = ed.getPosition()
      if (!pos) return
      const line = ed.getModel()?.getLineContent(pos.lineNumber) ?? ""
      const firstToken = line.trim().split(/\s+/)[0]
      if (firstToken) {
        const action = findAction(firstToken, schema)
        if (action) {
          const values = parseLineValues(line, action)
          setWizardState({ action, values, lineNumber: pos.lineNumber })
        }
      }
    }
  })
  return () => disposable.dispose()
}, [schema])

// 向导插入回调
const handleWizardInsert = useCallback((text: string) => {
  if (!wizardState || !editorRef.current) return
  const model = editorRef.current.getModel()
  if (!model) return
  const ln = wizardState.lineNumber
  const range = { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: model.getLineMaxColumn(ln) }
  editorRef.current.executeEdits("wizard", [{ range, text }])
  setWizardState(null)
}, [wizardState])

// 在 JSX 中，文本编辑器下方渲染向导浮层
{wizardState && schema && (
  <div className="absolute z-50" style={{ /* 定位到对应行 */ }}>
    <ParameterWizard
      action={wizardState.action} schema={schema}
      initialValues={wizardState.values}
      onInsert={handleWizardInsert}
      onCancel={() => setWizardState(null)} />
  </div>
)}
```

- [ ] **Step 3: 验证构建 + 提交**

```bash
cd web && npx tsc -b --noEmit
git add web/src/lib/kether-language.ts web/src/components/editor/ActionsEditor.tsx
git commit -m "feat: integrate ParameterWizard into Monaco with CodeLens + keybinding"
```
