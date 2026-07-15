import { describe, expect, it, vi } from "vitest"
import { parseKether, stringifyKether, type ScriptNode } from "../kether-ast"
import {
  analyzeFlowCompatibility,
  applyConnectionToFlow,
  astToFlow,
  flowToAst,
  initializeFlowFromText,
} from "../kether-flow"
import { toParserActionsSchema, type ActionsSchemaV2, type SchemaAction } from "@/types/schema"
import type { FlowState, KetherNode } from "@/components/editor/flow/flow-types"

const demoAction: SchemaAction = {
  name: "demo",
  aliases: ["d"],
  category: "test",
  namespace: "test",
  description: "roundtrip action",
  inputs: [
    { name: "value", key: "value", type: "STRING", required: true, default: null },
    { name: "count", key: "count", type: "INT", required: false, default: null, keyword: "count" },
    { name: "target", key: "target", type: "STRING", required: false, default: null, keyword: "target" },
  ],
  output: null,
  flow: "normal",
}

const schema: ActionsSchemaV2 = {
  version: 2,
  types: {
    STRING: { widget: "text", color: "#fff" },
    INT: { widget: "number", color: "#fff", step: 1 },
  },
  categories: { test: { color: "#fff", icon: "test" } },
  actions: [demoAction],
  selectors: [],
}

function position(index: number) {
  return { x: 0, y: index * 100 }
}

function dataNode(id: string, value: unknown, kind: "number" | "string" | "identifier" = "string"): KetherNode {
  return {
    id,
    type: "dataNode",
    position: position(0),
    data: {
      label: String(value),
      schemaAction: null,
      inputs: { value },
      inputKinds: { value: kind },
      slotChildren: {},
      nodeKind: "data",
    },
  }
}

function actionNode(id: string, y = 100): KetherNode {
  return {
    id,
    type: "actionNode",
    position: { x: 0, y },
    data: {
      label: "demo",
      schemaAction: demoAction,
      inputs: { value: "old" },
      inputKinds: { value: "identifier" },
      slotChildren: {},
      nodeKind: "action",
    },
  }
}

describe("V2 schema parser adapter", () => {
  it("将 inputs 正式映射为 parser params", () => {
    const parserSchema = toParserActionsSchema(schema)
    expect(parserSchema.actions[0].params).toEqual([
      expect.objectContaining({ name: "value", type: "STRING", optional: false }),
      expect.objectContaining({ name: "count", keyword: "count", optional: true }),
      expect.objectContaining({ name: "target", keyword: "target", optional: true }),
    ])
  })

  it("保持支持子集的位置参数、关键字参数和字面量类型往返", () => {
    const source = 'demo alpha count -2 target "quoted value"'
    const flow = initializeFlowFromText(source, schema)
    expect(flow.readOnlyReasons).toEqual([])

    const node = flow.nodes[0]
    expect(node.data.inputs).toEqual({ value: "alpha", count: "-2", target: "quoted value" })
    expect(node.data.inputKinds).toEqual({ value: "identifier", count: "number", target: "string" })
    expect(stringifyKether(flowToAst(flow, schema))).toBe(source)
  })

  it("省略的可选 keyword 不会在回写时被补成空值", () => {
    const source = "demo alpha"
    const flow = initializeFlowFromText(source, schema)
    expect(stringifyKether(flowToAst(flow, schema))).toBe(source)
  })
})

describe("Flow 初始化与只读保护", () => {
  it("初始化只返回 Flow state，不触发 emit", () => {
    const emit = vi.fn()
    const flow = initializeFlowFromText("demo alpha", schema)
    expect(flow.nodes).toHaveLength(1)
    expect(emit).not.toHaveBeenCalled()
  })

  it.each([
    ["comment", "demo alpha # keep me"],
    ["unknown action params", "mystery value"],
    ["case", "case value [ when one -> demo alpha ]"],
    ["check", "check one == two"],
    ["logic", "any [ true false ]"],
    ["math", "math + [ 1 2 ]"],
    ["flag", "flag test to true"],
    ["inline", 'inline "hello"'],
    ["lazy", "lazy &value"],
    ["sync modifier", "sync { demo alpha }"],
    ["async modifier", "async { demo alpha }"],
  ])("检测 %s 并禁用回写", (_name, source) => {
    const flow = initializeFlowFromText(source, schema)
    expect(flow.readOnlyReasons?.length).toBeGreaterThan(0)
    expect(() => flowToAst(flow, schema)).toThrow(/只读 Flow/)
  })

  it("检测 error、else-if 与复杂表达式", () => {
    const pos = { offset: 0, line: 1, column: 1 }
    const ast: ScriptNode = {
      type: "script",
      start: pos,
      end: pos,
      body: [
        { type: "error", message: "bad", raw: "bad", start: pos, end: pos },
        {
          type: "if",
          condition: { type: "boolean", value: true, start: pos, end: pos },
          thenBody: [],
          elseIfClauses: [{
            condition: { type: "boolean", value: false, start: pos, end: pos },
            body: [],
          }],
          elseBody: null,
          start: pos,
          end: pos,
        },
        {
          type: "set",
          variable: "x",
          value: { type: "lazy", expr: { type: "var_ref", name: "x", key: null, start: pos, end: pos }, start: pos, end: pos },
          start: pos,
          end: pos,
        },
      ],
    }
    const compatibility = analyzeFlowCompatibility(ast, schema)
    expect(compatibility.writable).toBe(false)
    expect(compatibility.reasons.join(" ")).toMatch(/error/)
    expect(compatibility.reasons.join(" ")).toMatch(/else-if/)
    expect(compatibility.reasons.join(" ")).toMatch(/复杂表达式 lazy/)
  })

  it("数值编辑中间态不会被静默序列化", () => {
    const ast = parseKether("demo alpha count -2", toParserActionsSchema(schema))
    const flow = astToFlow(ast, schema)
    flow.nodes[0].data.inputs.count = "-"
    expect(() => flowToAst(flow, schema)).toThrow(/尚未完成/)
  })
})

describe("AST 与 Flow 的执行顺序", () => {
  it("先创建 if/for 父节点，再创建所有 slot 子节点并生成结构与显示顺序边", () => {
    const source = [
      "demo start",
      "if true then {",
      "  demo then-one",
      "  for i in items then {",
      "    demo loop-one",
      "    demo loop-two",
      "  }",
      "  demo then-last",
      "} else {",
      "  demo else-one",
      "  demo else-two",
      "}",
      "demo end",
    ].join("\n")
    const ast = parseKether(source, toParserActionsSchema(schema))
    const flow = astToFlow(ast, schema)
    const branch = flow.nodes.find((node) => node.data.nodeKind === "branch")
    const loop = flow.nodes.find((node) => node.data.nodeKind === "loop")

    expect(branch).toBeDefined()
    expect(loop).toBeDefined()
    if (!branch || !loop) return

    const branchIndex = flow.nodes.findIndex((node) => node.id === branch.id)
    const loopIndex = flow.nodes.findIndex((node) => node.id === loop.id)
    const branchDescendantIndexes = flow.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.parentId === branch.id || node.parentId === loop.id)
      .map(({ index }) => index)
    const loopChildIndexes = flow.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.parentId === loop.id)
      .map(({ index }) => index)
    expect(branchDescendantIndexes.every((index) => branchIndex < index)).toBe(true)
    expect(loopChildIndexes.every((index) => loopIndex < index)).toBe(true)
    expect(flow.nodes.filter((node) => node.parentId).every((node) => (
      node.extent === undefined && node.expandParent !== true
    ))).toBe(true)

    const structureEdges = flow.edges.filter((edge) => edge.data?.kind === "structure")
    expect(structureEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: branch.id,
        target: branch.data.slotChildren.then[0],
        sourceHandle: "then-out",
        targetHandle: "flow-in",
        data: expect.objectContaining({ generated: true, semantic: false, slot: "then" }),
      }),
      expect.objectContaining({
        source: branch.id,
        target: branch.data.slotChildren.else[0],
        sourceHandle: "else-out",
        targetHandle: "flow-in",
        data: expect.objectContaining({ generated: true, semantic: false, slot: "else" }),
      }),
      expect.objectContaining({
        source: loop.id,
        target: loop.data.slotChildren.body[0],
        sourceHandle: "body-out",
        targetHandle: "flow-in",
        data: expect.objectContaining({ generated: true, semantic: false, slot: "body" }),
      }),
    ]))

    const topLevelIds = flow.nodes.filter((node) => !node.parentId).map((node) => node.id)
    const topExecutionEdges = flow.edges.filter((edge) => (
      edge.data?.kind === "execution" && edge.data.semantic === true
    ))
    expect(topExecutionEdges.map((edge) => [edge.source, edge.target])).toEqual([
      [topLevelIds[0], topLevelIds[1]],
      [topLevelIds[1], topLevelIds[2]],
    ])
    expect(topExecutionEdges.every((edge) => edge.data?.generated === true)).toBe(true)

    const thenExecutionEdges = flow.edges.filter((edge) => (
      edge.data?.kind === "execution" && edge.data.slot === "then"
    ))
    expect(thenExecutionEdges.map((edge) => [edge.source, edge.target])).toEqual([
      [branch.data.slotChildren.then[0], branch.data.slotChildren.then[1]],
      [branch.data.slotChildren.then[1], branch.data.slotChildren.then[2]],
    ])
    expect(thenExecutionEdges.every((edge) => edge.data?.generated === true && edge.data.semantic === false)).toBe(true)
  })

  it("透明 block 展开多个节点时仍按可视顺序生成相邻执行边", () => {
    const pos = { offset: 0, line: 1, column: 1 }
    const action = (value: string) => ({
      type: "action_call" as const,
      name: "demo",
      args: [{ type: "identifier" as const, name: value, start: pos, end: pos }],
      keywordArgs: {},
      start: pos,
      end: pos,
    })
    const ast: ScriptNode = {
      type: "script",
      start: pos,
      end: pos,
      body: [
        action("before"),
        {
          type: "block",
          modifier: null,
          body: [
            action("inside-one"),
            { type: "block", modifier: null, body: [action("inside-two")], start: pos, end: pos },
          ],
          start: pos,
          end: pos,
        },
        action("after"),
      ],
    }

    const flow = astToFlow(ast, schema)
    expect(flow.nodes.map((node) => node.data.inputs.value)).toEqual([
      "before",
      "inside-one",
      "inside-two",
      "after",
    ])
    expect(flow.edges.filter((edge) => edge.data?.kind === "execution").map((edge) => [edge.source, edge.target])).toEqual([
      [flow.nodes[0].id, flow.nodes[1].id],
      [flow.nodes[1].id, flow.nodes[2].id],
      [flow.nodes[2].id, flow.nodes[3].id],
    ])
  })

  it("部分执行边与孤立节点并存时，每轮都按画布位置稳定选择下一个节点", () => {
    const first = actionNode("first", 0)
    first.data.inputs.value = "first"
    const second = actionNode("second", 100)
    second.data.inputs.value = "second"
    const isolated = actionNode("isolated", 300)
    isolated.data.inputs.value = "isolated"
    const state: FlowState = {
      nodes: [first, second, isolated],
      edges: [{
        id: "first-to-second",
        source: first.id,
        sourceHandle: "flow-out",
        target: second.id,
        targetHandle: "flow-in",
        data: { kind: "execution", semantic: true, generated: false },
      }],
    }

    expect(stringifyKether(flowToAst(state, schema))).toBe([
      "demo first",
      "demo second",
      "demo isolated",
    ].join("\n"))
  })

  it("结构边和 semantic=false 的显示边不会改变 AST 往返结果", () => {
    const source = [
      "demo start",
      "if true then {",
      "  demo then-one",
      "  demo then-two",
      "} else {",
      "  demo else-one",
      "}",
      "demo end",
    ].join("\n")
    const ast = parseKether(source, toParserActionsSchema(schema))
    const flow = astToFlow(ast, schema)
    const topLevel = flow.nodes.filter((node) => !node.parentId)
    flow.edges.push(
      {
        id: "display-reverse",
        source: topLevel[2].id,
        target: topLevel[0].id,
        sourceHandle: "flow-out",
        targetHandle: "flow-in",
        data: { kind: "execution", generated: true, semantic: false },
      },
      {
        id: "structure-reverse",
        source: topLevel[2].id,
        target: topLevel[0].id,
        sourceHandle: "body-out",
        targetHandle: "flow-in",
        data: { kind: "structure", generated: true, semantic: false },
      },
    )

    expect(stringifyKether(flowToAst(flow, schema))).toBe(stringifyKether(ast))
  })
})

describe("Flow connection mapping", () => {
  it("数据连线写入目标 handle 对应参数，并保留值类型", () => {
    const state: FlowState = { nodes: [dataNode("data", "-3.5", "number"), actionNode("action")], edges: [] }
    const result = applyConnectionToFlow(state, {
      source: "data",
      sourceHandle: "output",
      target: "action",
      targetHandle: "count",
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.kind).toBe("data")
    expect(result.state.nodes[1].data.inputs.count).toBe("-3.5")
    expect(result.state.nodes[1].data.inputKinds.count).toBe("number")
    expect(result.state.edges[0].data?.kind).toBe("data")
    expect(stringifyKether(flowToAst(result.state, schema))).toBe("demo old count -3.5")
  })

  it("Calc 的 formula 数据端口保留原有表达式编辑与回写能力", () => {
    const calc: KetherNode = {
      id: "calc",
      type: "calcNode",
      position: position(1),
      data: {
        label: "calc",
        schemaAction: null,
        inputs: { formula: "1+1" },
        inputKinds: { formula: "string" },
        slotChildren: {},
        nodeKind: "calc",
      },
    }
    const state: FlowState = { nodes: [dataNode("data", "2+3*level"), calc], edges: [] }
    const result = applyConnectionToFlow(state, {
      source: "data",
      sourceHandle: "output",
      target: "calc",
      targetHandle: "formula",
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.nodes[1].data.inputs.formula).toBe("2+3*level")
    expect(stringifyKether(flowToAst(result.state, schema))).toBe('calc "2+3*level"')
  })

  it("无法映射的目标 handle 会明确拒绝且不修改 state", () => {
    const state: FlowState = { nodes: [dataNode("data", "value"), actionNode("action")], edges: [] }
    const result = applyConnectionToFlow(state, {
      source: "data",
      sourceHandle: "output",
      target: "action",
      targetHandle: "missing",
    })
    expect(result).toEqual(expect.objectContaining({ accepted: false, state }))
    if (result.accepted) return
    expect(result.reason).toMatch(/无法映射/)
  })

  it("非数据输出不能伪装成参数值", () => {
    const state: FlowState = { nodes: [actionNode("source", 0), actionNode("target", 100)], edges: [] }
    const result = applyConnectionToFlow(state, {
      source: "source",
      sourceHandle: "output",
      target: "target",
      targetHandle: "value",
    })
    expect(result.accepted).toBe(false)
  })

  it("用户创建顶层执行边时替换自动语义边，且不覆盖输入", () => {
    const state = initializeFlowFromText("demo first\ndemo second", schema)
    const [first, second] = state.nodes
    expect(state.edges).toEqual([
      expect.objectContaining({
        source: first.id,
        target: second.id,
        data: expect.objectContaining({ kind: "execution", generated: true, semantic: true }),
      }),
    ])

    const result = applyConnectionToFlow(state, {
      source: second.id,
      sourceHandle: "flow-out",
      target: first.id,
      targetHandle: "flow-in",
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.kind).toBe("execution")
    expect(result.state.nodes.map((node) => node.data.inputs.value)).toEqual(["first", "second"])
    expect(result.state.edges.some((edge) => (
      edge.data?.kind === "execution" && edge.data.generated === true && edge.data.semantic === true
    ))).toBe(false)
    expect(result.state.edges).toEqual([
      expect.objectContaining({
        source: second.id,
        target: first.id,
        data: expect.objectContaining({ kind: "execution", generated: false, semantic: true }),
      }),
    ])
    expect(stringifyKether(flowToAst(result.state, schema))).toBe("demo second\ndemo first")
  })
})
