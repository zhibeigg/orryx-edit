import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { NodeProps } from "@xyflow/react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import type { KetherNodeData } from "../flow-types"
import { SchemaProvider } from "../SchemaContext"
import { ActionNode } from "./ActionNode"
import { BranchNode } from "./BranchNode"
import { LoopNode } from "./LoopNode"
import { DataNode } from "./DataNode"
import { CalcNode } from "./CalcNode"
import { SetNode } from "./SetNode"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ id, type, position }: { id?: string; type: string; position: string }) => (
      <span data-handle-id={id} data-handle-type={type} data-handle-position={position} />
    ),
    useUpdateNodeInternals: () => () => undefined,
  }
})

const action: SchemaAction = {
  name: "damage",
  aliases: [],
  category: "combat",
  namespace: "orryx",
  description: "造成伤害",
  inputs: [
    { name: "目标", key: "target", type: "ENTITY", required: true, default: null },
    { name: "伤害", key: "amount", type: "NUMBER", required: true, default: 1 },
    { name: "伤害类型", key: "damageType", type: "STRING", required: false, default: "skill" },
  ],
  output: { type: "NUMBER", description: "实际伤害" },
  flow: "normal",
}

const schema: ActionsSchemaV2 = {
  version: 2,
  types: {
    ENTITY: { widget: "text", color: "#60a5fa" },
    NUMBER: { widget: "number", color: "#f59e0b" },
    STRING: { widget: "text", color: "#a78bfa" },
  },
  categories: { combat: { color: "#9f2f28", icon: "sword" } },
  actions: [action],
  selectors: [],
}

function renderNode(id: string, data: KetherNodeData, Component: typeof ActionNode): string {
  const props = { id, data, selected: false } as unknown as NodeProps
  return renderToStaticMarkup(
    <SchemaProvider value={schema}>
      <Component {...props} />
    </SchemaProvider>,
  )
}

function handleIds(markup: string): string[] {
  return [...markup.matchAll(/data-handle-id="([^"]+)"/g)].map((match) => match[1])
}

function baseData(nodeKind: KetherNodeData["nodeKind"]): KetherNodeData {
  return {
    label: nodeKind,
    schemaAction: null,
    inputs: {},
    inputKinds: {},
    slotChildren: {},
    nodeKind,
  }
}

describe("Flow 节点端口", () => {
  it("Action 的执行、数据输入和数据输出端口分区且 ID 唯一", () => {
    const markup = renderNode("action-1", {
      ...baseData("action"),
      label: action.name,
      schemaAction: action,
      inputs: { target: "self", amount: 10, damageType: "skill" },
      inputKinds: { target: "identifier", amount: "number", damageType: "string" },
    }, ActionNode)
    const ids = handleIds(markup)

    expect(ids).toEqual(["flow-in", "flow-out", "target", "amount", "damageType", "output"])
    expect(new Set(ids).size).toBe(ids.length)
    expect(markup).toContain('data-handle-id="target" data-handle-type="target" data-handle-position="left"')
    expect(markup).toContain('data-handle-id="output" data-handle-type="source" data-handle-position="right"')
  })

  it("Branch、Loop 与 Calc 在端口重构后仍保留原有可编辑字段", () => {
    const branchMarkup = renderNode("branch-edit", {
      ...baseData("branch"),
      inputs: { condition: "&ready" },
      inputKinds: { condition: "var_ref" },
      slotChildren: { then: [], else: [] },
    }, BranchNode as typeof ActionNode)
    const loopMarkup = renderNode("loop-edit", {
      ...baseData("loop"),
      inputs: { variable: "player", iterable: "&players" },
      inputKinds: { variable: "identifier", iterable: "var_ref" },
      slotChildren: { body: [] },
    }, LoopNode as typeof ActionNode)
    const calcMarkup = renderNode("calc-edit", {
      ...baseData("calc"),
      inputs: { formula: "2+3*level" },
      inputKinds: { formula: "string" },
    }, CalcNode as typeof ActionNode)

    expect(branchMarkup).toContain('value="&amp;ready"')
    expect(loopMarkup).toContain('value="player"')
    expect(loopMarkup).toContain('value="&amp;players"')
    expect(calcMarkup).toContain('value="2+3*level"')
  })

  it.each([
    ["branch", BranchNode, { inputs: { condition: true }, inputKinds: { condition: "boolean" as const }, slotChildren: { then: [], else: [] } }, ["flow-in", "flow-out", "condition", "then-out", "else-out"]],
    ["loop", LoopNode, { inputs: { variable: "i", iterable: "players" }, inputKinds: { variable: "identifier" as const, iterable: "identifier" as const }, slotChildren: { body: [] } }, ["flow-in", "flow-out", "iterable", "body-out"]],
    ["data", DataNode, { inputs: { value: "self" }, inputKinds: { value: "identifier" as const }, slotChildren: {} }, ["flow-in", "flow-out", "output"]],
    ["calc", CalcNode, { inputs: { formula: "1+2" }, inputKinds: { formula: "string" as const }, slotChildren: {} }, ["flow-in", "flow-out", "formula", "output"]],
    ["set", SetNode, { inputs: { variable: "damage", value: 10 }, inputKinds: { variable: "identifier" as const, value: "number" as const }, slotChildren: {} }, ["flow-in", "flow-out", "value"]],
  ])("%s 节点的 Handle ID 稳定且无重复", (nodeKind, Component, overrides, expectedIds) => {
    const data = { ...baseData(nodeKind as KetherNodeData["nodeKind"]), ...overrides } as KetherNodeData
    const ids = handleIds(renderNode(`${nodeKind}-1`, data, Component as typeof ActionNode))

    expect(ids).toEqual(expectedIds)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
