import { describe, expect, it } from "vitest"
import type { KetherEdge, KetherNode } from "./flow-types"
import { getNodeSize, layoutFlowGraph, normalizeParentFirstNodeOrder } from "./flow-layout"

interface SlotRect {
  x: number
  y: number
  width: number
  height: number
}

function node(
  id: string,
  kind: KetherNode["data"]["nodeKind"] = "action",
  options: Partial<KetherNode> = {},
): KetherNode {
  const slotChildren = kind === "branch"
    ? { then: [], else: [] }
    : kind === "loop"
      ? { body: [] }
      : {}
  return {
    id,
    type: `${kind}Node`,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      schemaAction: null,
      inputs: {},
      inputKinds: {},
      slotChildren,
      nodeKind: kind,
    },
    ...options,
  } as KetherNode
}

function execution(source: string, target: string): KetherEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    data: { kind: "execution" },
  } as KetherEdge
}

function dataEdge(source: string, target: string, targetHandle: string): KetherEdge {
  return {
    id: `${source}->${target}:${targetHandle}`,
    source,
    target,
    sourceHandle: "output",
    targetHandle,
    data: { kind: "data", sourcePort: "output", targetPort: targetHandle },
  } as KetherEdge
}

function byId(nodes: KetherNode[], id: string): KetherNode {
  const result = nodes.find((candidate) => candidate.id === id)
  expect(result, `缺少节点 ${id}`).toBeDefined()
  return result as KetherNode
}

function size(nodeValue: KetherNode): { width: number; height: number } {
  const width = typeof nodeValue.style?.width === "number" ? nodeValue.style.width : getNodeSize(nodeValue).width
  const height = typeof nodeValue.style?.height === "number" ? nodeValue.style.height : getNodeSize(nodeValue).height
  return { width, height }
}

function slots(nodeValue: KetherNode): Record<string, SlotRect> {
  return ((nodeValue.data as KetherNode["data"] & {
    layout?: { slots?: Record<string, SlotRect> }
  }).layout?.slots ?? {})
}

function expectContained(parent: KetherNode, child: KetherNode) {
  const parentSize = size(parent)
  const childSize = size(child)
  expect(child.position.x).toBeGreaterThanOrEqual(0)
  expect(child.position.y).toBeGreaterThanOrEqual(0)
  expect(child.position.x + childSize.width).toBeLessThanOrEqual(parentSize.width)
  expect(child.position.y + childSize.height).toBeLessThanOrEqual(parentSize.height)
}

function expectFiniteGraph(nodes: KetherNode[]) {
  for (const current of nodes) {
    const currentSize = size(current)
    expect(Number.isFinite(current.position.x)).toBe(true)
    expect(Number.isFinite(current.position.y)).toBe(true)
    expect(Number.isFinite(currentSize.width)).toBe(true)
    expect(Number.isFinite(currentSize.height)).toBe(true)
  }
}

describe("flow layout 尺寸解析", () => {
  it("逐维优先 measured、显式尺寸和 style，并在缺失 measured 时回退", () => {
    const measured = node("measured", "action", {
      measured: { width: 310, height: 170 },
      width: 280,
      height: 130,
      style: { width: 250, height: 100 },
    })
    expect(getNodeSize(measured)).toEqual({ width: 310, height: 170 })

    const explicit = node("explicit", "action", {
      measured: { width: undefined, height: Number.NaN },
      width: 275,
      style: { height: "122px" },
    })
    expect(getNodeSize(explicit)).toEqual({ width: 275, height: 122 })

    const fallback = node("fallback", "action", {
      data: {
        ...node("base").data,
        inputs: { a: "", b: "", c: "" },
      },
    })
    const fallbackSize = getNodeSize(fallback)
    expect(fallbackSize.width).toBeGreaterThan(0)
    expect(fallbackSize.height).toBeGreaterThan(100)
    expect(Number.isFinite(fallbackSize.width)).toBe(true)
    expect(Number.isFinite(fallbackSize.height)).toBe(true)
  })
})

describe("flow layout 顶层 dagre", () => {
  it("使用实际不同高度布局执行链且节点不重叠", () => {
    const result = layoutFlowGraph([
      node("short", "action", { measured: { width: 220, height: 70 } }),
      node("tall", "action", { measured: { width: 260, height: 230 } }),
      node("last", "action", { measured: { width: 200, height: 96 } }),
    ], [execution("short", "tall"), execution("tall", "last")], { mode: "force" })

    const short = byId(result.nodes, "short")
    const tall = byId(result.nodes, "tall")
    const last = byId(result.nodes, "last")
    expect(tall.position.y).toBeGreaterThanOrEqual(short.position.y + getNodeSize(short).height)
    expect(last.position.y).toBeGreaterThanOrEqual(tall.position.y + getNodeSize(tall).height)
    expectFiniteGraph(result.nodes)
  })

  it("preserve 保留锁定和已有手工坐标，只放置新增节点并避开锁定节点", () => {
    const locked = node("locked", "action", {
      position: { x: 420, y: 180 },
      measured: { width: 240, height: 140 },
    })
    const manual = node("manual", "action", {
      position: { x: 40, y: 520 },
      measured: { width: 220, height: 90 },
    })
    const added = node("added", "action", {
      position: { x: 420, y: 180 },
      measured: { width: 240, height: 120 },
    })
    const preserved = layoutFlowGraph(
      [locked, manual, added],
      [],
      { mode: "preserve", lockedNodeIds: ["locked"], newNodeIds: ["added"] },
    )
    const lockedAfter = byId(preserved.nodes, "locked")
    const manualAfter = byId(preserved.nodes, "manual")
    const addedAfter = byId(preserved.nodes, "added")
    expect(lockedAfter.position).toEqual({ x: 420, y: 180 })
    expect(manualAfter.position).toEqual({ x: 40, y: 520 })
    expect(
      addedAfter.position.x >= lockedAfter.position.x + getNodeSize(lockedAfter).width
      || addedAfter.position.x + getNodeSize(addedAfter).width <= lockedAfter.position.x
      || addedAfter.position.y >= lockedAfter.position.y + getNodeSize(lockedAfter).height
      || addedAfter.position.y + getNodeSize(addedAfter).height <= lockedAfter.position.y,
    ).toBe(true)

    const forced = layoutFlowGraph([locked], [], { mode: "force", lockedNodeIds: ["locked"] })
    expect(byId(forced.nodes, "locked").position).not.toEqual({ x: 420, y: 180 })
  })
})

describe("flow layout 递归容器", () => {
  it("Branch 为 then/else 建立上下分区并完全包围不同高度子节点", () => {
    const branch = node("branch", "branch", {
      data: {
        ...node("branch-data", "branch").data,
        slotChildren: { then: ["then-b", "then-a"], else: ["else-a"] },
      },
    })
    const thenA = node("then-a", "action", {
      parentId: "branch",
      measured: { width: 210, height: 80 },
    })
    const thenB = node("then-b", "action", {
      parentId: "branch",
      measured: { width: 250, height: 155 },
    })
    const elseA = node("else-a", "action", {
      parentId: "branch",
      measured: { width: 230, height: 110 },
    })
    const result = layoutFlowGraph(
      [thenA, branch, elseA, thenB],
      [execution("then-a", "then-b")],
      { mode: "force" },
    )
    const branchAfter = byId(result.nodes, "branch")
    const thenAAfter = byId(result.nodes, "then-a")
    const thenBAfter = byId(result.nodes, "then-b")
    const elseAfter = byId(result.nodes, "else-a")
    const branchSlots = slots(branchAfter)

    expect(result.nodes.indexOf(branchAfter)).toBeLessThan(result.nodes.indexOf(thenAAfter))
    expect(thenAAfter.position.y).toBeLessThan(thenBAfter.position.y)
    expect(branchSlots.then.y + branchSlots.then.height).toBeLessThanOrEqual(branchSlots.else.y)
    expectContained(branchAfter, thenAAfter)
    expectContained(branchAfter, thenBAfter)
    expectContained(branchAfter, elseAfter)
    expectFiniteGraph(result.nodes)
  })

  it("Loop body 与嵌套 Branch 自底向上扩张并包围整棵子树", () => {
    const outer = node("outer", "loop", {
      data: {
        ...node("outer-data", "loop").data,
        slotChildren: { body: ["inner"] },
      },
    })
    const inner = node("inner", "branch", {
      parentId: "outer",
      data: {
        ...node("inner-data", "branch").data,
        slotChildren: { then: ["leaf-a"], else: ["leaf-b"] },
      },
    })
    const leafA = node("leaf-a", "action", {
      parentId: "inner",
      measured: { width: 330, height: 180 },
    })
    const leafB = node("leaf-b", "action", {
      parentId: "inner",
      measured: { width: 200, height: 76 },
    })

    const result = layoutFlowGraph([leafB, inner, leafA, outer], [], { mode: "force" })
    const outerAfter = byId(result.nodes, "outer")
    const innerAfter = byId(result.nodes, "inner")
    const leafAAfter = byId(result.nodes, "leaf-a")
    const leafBAfter = byId(result.nodes, "leaf-b")

    expect(result.nodes.map((item) => item.id)).toEqual(["outer", "inner", "leaf-b", "leaf-a"])
    expect(slots(outerAfter).body).toBeDefined()
    expect(slots(innerAfter).then).toBeDefined()
    expect(slots(innerAfter).else).toBeDefined()
    expectContained(outerAfter, innerAfter)
    expectContained(innerAfter, leafAAfter)
    expectContained(innerAfter, leafBAfter)
    expect(size(outerAfter).width).toBeGreaterThanOrEqual(size(innerAfter).width)
    expectFiniteGraph(result.nodes)
  })

  it("重复强制布局保持稳定，旧容器测量值不会阻止删除子节点后的收缩", () => {
    const loop = node("loop", "loop", {
      data: {
        ...node("loop-data", "loop").data,
        slotChildren: { body: ["first", "second"] },
      },
    })
    const first = node("first", "action", {
      parentId: "loop",
      measured: { width: 300, height: 180 },
    })
    const second = node("second", "action", {
      parentId: "loop",
      measured: { width: 300, height: 220 },
    })
    const initial = layoutFlowGraph([second, loop, first], [execution("first", "second")], { mode: "force" })
    const repeated = layoutFlowGraph(initial.nodes, [execution("first", "second")], { mode: "force" })

    const snapshot = (nodes: KetherNode[]) => nodes.map((item) => ({
      id: item.id,
      position: item.position,
      width: item.style?.width,
      height: item.style?.height,
      layout: item.data.layout,
    }))
    expect(snapshot(repeated.nodes)).toEqual(snapshot(initial.nodes))

    const previousLoop = byId(repeated.nodes, "loop")
    const previousSize = size(previousLoop)
    const loopWithoutSecond: KetherNode = {
      ...previousLoop,
      measured: previousSize,
      data: {
        ...previousLoop.data,
        slotChildren: { body: ["first"] },
      },
    }
    const shrunk = layoutFlowGraph([
      loopWithoutSecond,
      byId(repeated.nodes, "first"),
    ], [], { mode: "force" })
    expect(size(byId(shrunk.nodes, "loop")).height).toBeLessThan(previousSize.height)
  })
})

describe("flow layout data satellite", () => {
  it("把纯数据源放到目标左侧，并按目标输入顺序纵向排列", () => {
    const target = node("target", "action", {
      data: {
        ...node("target-data").data,
        inputs: { first: "", second: "" },
      },
      measured: { width: 260, height: 150 },
    })
    const second = node("second-source", "data", { measured: { width: 160, height: 72 } })
    const first = node("first-source", "data", { measured: { width: 180, height: 88 } })
    const result = layoutFlowGraph(
      [second, target, first],
      [dataEdge("second-source", "target", "second"), dataEdge("first-source", "target", "first")],
      { mode: "force" },
    )
    const targetAfter = byId(result.nodes, "target")
    const firstAfter = byId(result.nodes, "first-source")
    const secondAfter = byId(result.nodes, "second-source")

    expect(firstAfter.position.x + getNodeSize(firstAfter).width).toBeLessThan(targetAfter.position.x)
    expect(secondAfter.position.x + getNodeSize(secondAfter).width).toBeLessThan(targetAfter.position.x)
    expect(firstAfter.position.y).toBeLessThan(secondAfter.position.y)
    expectFiniteGraph(result.nodes)
  })
})

describe("normalizeParentFirstNodeOrder", () => {
  it("保持稳定顺序同时确保父节点先于子节点", () => {
    const parent = node("parent", "loop")
    const child = node("child", "action", { parentId: "parent" })
    const unrelated = node("unrelated")
    expect(normalizeParentFirstNodeOrder([child, unrelated, parent]).map((item) => item.id))
      .toEqual(["parent", "child", "unrelated"])
  })
})
