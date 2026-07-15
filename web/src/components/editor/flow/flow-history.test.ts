import { describe, expect, it } from "vitest"
import { bindFlowNodeInteractions, hasSemanticFlowChange } from "./flow-history"
import type { KetherEdge, KetherNode } from "./flow-types"

function node(position: { x: number; y: number }, input = "same"): KetherNode {
  return {
    id: "node-1",
    type: "actionNode",
    position,
    data: {
      label: "action",
      schemaAction: null,
      inputs: { value: input },
      inputKinds: { value: "string" },
      slotChildren: {},
      nodeKind: "action",
    },
  } as KetherNode
}

const edges: KetherEdge[] = []

describe("Flow 历史语义判定", () => {
  it("仅坐标、尺寸或选择态变化不属于文本语义变化", () => {
    const current = { nodes: [node({ x: 10, y: 20 })], edges }
    const layoutOnly = {
      nodes: [{ ...node({ x: 300, y: 400 }), selected: true, measured: { width: 180, height: 80 } } as KetherNode],
      edges,
    }

    expect(hasSemanticFlowChange(current, layoutOnly)).toBe(false)
  })

  it("参数语义变化必须触发文本回写", () => {
    expect(hasSemanticFlowChange(
      { nodes: [node({ x: 10, y: 20 }, "old")], edges },
      { nodes: [node({ x: 10, y: 20 }, "new")], edges },
    )).toBe(true)
  })
})

describe("Flow 节点交互绑定", () => {
  it("为解析后的节点派生输入回调且不污染原始语义节点", () => {
    const rawNode = node({ x: 10, y: 20 })
    const inputChanges: unknown[][] = []
    const [interactiveNode] = bindFlowNodeInteractions(
      [rawNode],
      () => undefined,
      (nodeId, key, value, kind) => inputChanges.push([nodeId, key, value, kind]),
    )

    expect(rawNode.data.onInputChange).toBeUndefined()
    interactiveNode.data.onInputChange?.("value", "完整字符串", "string")

    expect(inputChanges).toEqual([["node-1", "value", "完整字符串", "string"]])
  })
})
