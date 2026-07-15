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

  it("顶层 flow 端口连线只改变执行排序，不覆盖输入", () => {
    const first = actionNode("first", 0)
    first.data.inputs.value = "first"
    const second = actionNode("second", 100)
    second.data.inputs.value = "second"
    const state: FlowState = { nodes: [first, second], edges: [] }
    const result = applyConnectionToFlow(state, {
      source: "second",
      sourceHandle: "flow-out",
      target: "first",
      targetHandle: "flow-in",
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.kind).toBe("execution")
    expect(result.state.nodes.map((node) => node.data.inputs.value)).toEqual(["first", "second"])
    expect(stringifyKether(flowToAst(result.state, schema))).toBe("demo second\ndemo first")
  })
})
