import { describe, expect, it } from "vitest"
import type { KetherEdge, KetherNode, KetherNodeData } from "./flow-types"
import { rebuildGeneratedFlowEdges } from "./flow-edges"

function node(
  id: string,
  kind: KetherNodeData["nodeKind"] = "action",
  position = { x: 0, y: 0 },
  parentId?: string,
): KetherNode {
  return {
    id,
    type: `${kind}Node`,
    position,
    parentId,
    data: {
      label: id,
      schemaAction: null,
      inputs: kind === "data" ? { value: id } : {},
      inputKinds: kind === "data" ? { value: "string" } : {},
      slotChildren: kind === "branch" ? { then: [], else: [] } : kind === "loop" ? { body: [] } : {},
      nodeKind: kind,
    },
  }
}

function generatedExecution(source: string, target: string, semantic: boolean): KetherEdge {
  return {
    id: `old:${source}->${target}`,
    source,
    sourceHandle: "flow-out",
    target,
    targetHandle: "flow-in",
    data: { kind: "execution", generated: true, semantic },
  }
}

describe("rebuildGeneratedFlowEdges", () => {
  it("子节点删除后按 slotChildren 重建结构入口和连续顺序边", () => {
    const branch = node("branch", "branch")
    branch.data.slotChildren = { then: ["first", "last"], else: [] }
    const first = node("first", "action", { x: 24, y: 112 }, branch.id)
    const last = node("last", "action", { x: 24, y: 240 }, branch.id)
    const staleEdges: KetherEdge[] = [
      {
        id: "old-structure",
        source: branch.id,
        sourceHandle: "then-out",
        target: "deleted",
        targetHandle: "flow-in",
        data: { kind: "structure", generated: true, semantic: false },
      },
      generatedExecution(first.id, "deleted", false),
      generatedExecution("deleted", last.id, false),
    ]

    const result = rebuildGeneratedFlowEdges([branch, first, last], staleEdges)
    expect(result).toEqual([
      expect.objectContaining({
        source: branch.id,
        target: first.id,
        sourceHandle: "then-out",
        data: expect.objectContaining({ kind: "structure", generated: true, semantic: false }),
      }),
      expect.objectContaining({
        source: first.id,
        target: last.id,
        data: expect.objectContaining({ kind: "execution", generated: true, semantic: false }),
      }),
    ])
  })

  it("把已连接参数的数据节点排除在顶层执行链之外", () => {
    const data = node("data", "data", { x: -300, y: 100 })
    const first = node("first", "action", { x: 0, y: 0 })
    const second = node("second", "action", { x: 0, y: 200 })
    const dataEdge: KetherEdge = {
      id: "data->second:value",
      source: data.id,
      sourceHandle: "output",
      target: second.id,
      targetHandle: "value",
      data: { kind: "data", sourcePort: "output", targetPort: "value" },
    }

    const result = rebuildGeneratedFlowEdges(
      [data, second, first],
      [dataEdge, generatedExecution(data.id, first.id, true), generatedExecution(first.id, second.id, true)],
    )
    expect(result.filter((edge) => edge.data?.kind === "data")).toEqual([dataEdge])
    expect(result.filter((edge) => edge.data?.kind === "execution")).toEqual([
      expect.objectContaining({ source: first.id, target: second.id, data: expect.objectContaining({ semantic: true }) }),
    ])
  })

  it("重建 slot 边时保留已有自动语义顺序，不把手工画布位置误当成执行重排", () => {
    const first = node("first", "action", { x: 0, y: 400 })
    const second = node("second", "action", { x: 0, y: 0 })

    const result = rebuildGeneratedFlowEdges(
      [first, second],
      [generatedExecution(first.id, second.id, true)],
    )
    expect(result).toEqual([
      expect.objectContaining({ source: first.id, target: second.id, data: expect.objectContaining({ semantic: true }) }),
    ])
  })

  it("存在手工语义执行边时不覆盖用户顺序", () => {
    const first = node("first", "action", { x: 0, y: 0 })
    const second = node("second", "action", { x: 0, y: 200 })
    const manual: KetherEdge = {
      id: "manual",
      source: second.id,
      sourceHandle: "flow-out",
      target: first.id,
      targetHandle: "flow-in",
      data: { kind: "execution", generated: false, semantic: true },
    }

    const result = rebuildGeneratedFlowEdges([first, second], [manual, generatedExecution(first.id, second.id, true)])
    expect(result).toEqual([manual])
  })
})
