import dagre from "@dagrejs/dagre"
import type {
  KetherEdge,
  KetherNode,
  KetherNodeLayout,
  KetherSlotLayout,
} from "./flow-types"

export type FlowLayoutMode = "force" | "preserve"

export interface FlowLayoutOptions {
  mode?: FlowLayoutMode
  lockedNodeIds?: Iterable<string>
  newNodeIds?: Iterable<string>
  nodeSeparation?: number
  rankSeparation?: number
  slotGap?: number
  satelliteGap?: number
}

export interface FlowLayoutResult {
  nodes: KetherNode[]
  changedNodeIds: string[]
  topLevelNodeIds: string[]
}

interface Size {
  width: number
  height: number
}

interface Rect extends Size {
  x: number
  y: number
}

const DEFAULT_NODE_SEPARATION = 48
const DEFAULT_RANK_SEPARATION = 72
const DEFAULT_SLOT_GAP = 18
const DEFAULT_SATELLITE_GAP = 56
const SLOT_OUTER_PADDING = 12
const SLOT_INNER_PADDING = 12
const SLOT_LABEL_HEIGHT = 24
const CONTAINER_HEADER_HEIGHT = 76
const CONTAINER_BOTTOM_PADDING = 12
const MIN_SLOT_HEIGHT = 64

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function positive(value: unknown): number | undefined {
  const number = finite(value, Number.NaN)
  return number > 0 ? number : undefined
}

function styleDimension(value: unknown): number | undefined {
  if (typeof value === "number") return positive(value)
  if (typeof value !== "string") return undefined
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value)
  return match ? positive(Number(match[1])) : undefined
}

function fallbackNodeSize(node: KetherNode): Size {
  const inputCount = node.data.nodeKind === "action"
    ? Math.max(
      node.data.schemaAction?.inputs.length ?? 0,
      Object.keys(node.data.inputs ?? {}).length,
    )
    : Object.keys(node.data.inputs ?? {}).length

  switch (node.data.nodeKind) {
    case "branch": return { width: 380, height: CONTAINER_HEADER_HEIGHT }
    case "loop": return { width: 380, height: CONTAINER_HEADER_HEIGHT }
    case "data": return { width: 260, height: 96 }
    case "set": return { width: 300, height: 126 }
    case "calc": return { width: 280, height: 148 }
    case "action":
    default:
      return { width: 320, height: Math.max(96, 54 + inputCount * 40) }
  }
}

/** 在没有 DOM 的情况下取得稳定节点尺寸，逐维遵循 measured、显式尺寸、style、fallback 的优先级。 */
export function getNodeSize(node: KetherNode): Size {
  const fallback = fallbackNodeSize(node)
  return {
    width: positive(node.measured?.width)
      ?? positive(node.width)
      ?? styleDimension(node.style?.width)
      ?? fallback.width,
    height: positive(node.measured?.height)
      ?? positive(node.height)
      ?? styleDimension(node.style?.height)
      ?? fallback.height,
  }
}

function iterableSet(values: Iterable<string> | undefined): Set<string> {
  return new Set(values ?? [])
}

function isExecutionEdge(edge: KetherEdge): boolean {
  return edge.data?.kind === "execution" || (!edge.data?.kind && !edge.targetHandle)
}

function isSemanticExecutionEdge(edge: KetherEdge): boolean {
  return isExecutionEdge(edge) && edge.data?.semantic !== false
}

function isDataEdge(edge: KetherEdge): boolean {
  return edge.data?.kind === "data" || Boolean(edge.targetHandle && edge.sourceHandle !== "flow-out")
}

function semanticOrder(ids: string[], edges: KetherEdge[]): string[] {
  if (ids.length < 2) return [...ids]
  const idSet = new Set(ids)
  const index = new Map(ids.map((id, position) => [id, position]))
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]))
  const incoming = new Map(ids.map((id) => [id, 0]))

  for (const edge of edges) {
    if (!isExecutionEdge(edge) || !idSet.has(edge.source) || !idSet.has(edge.target)) continue
    const targets = outgoing.get(edge.source)
    if (!targets || targets.includes(edge.target)) continue
    targets.push(edge.target)
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
  }

  const queue = ids.filter((id) => incoming.get(id) === 0)
  const result: string[] = []
  while (queue.length > 0) {
    queue.sort((left, right) => (index.get(left) ?? 0) - (index.get(right) ?? 0))
    const current = queue.shift()
    if (!current) break
    result.push(current)
    for (const target of outgoing.get(current) ?? []) {
      const next = (incoming.get(target) ?? 0) - 1
      incoming.set(target, next)
      if (next === 0) queue.push(target)
    }
  }

  if (result.length === ids.length) return result
  const seen = new Set(result)
  return [...result, ...ids.filter((id) => !seen.has(id))]
}

function nodeSlotNames(node: KetherNode): string[] {
  if (node.data.nodeKind === "branch") return ["then", "else"]
  if (node.data.nodeKind === "loop") return ["body"]
  return Object.keys(node.data.slotChildren ?? {})
}

function isContainer(node: KetherNode): boolean {
  return node.data.nodeKind === "branch"
    || node.data.nodeKind === "loop"
    || Object.keys(node.data.slotChildren ?? {}).length > 0
}

function hasManualPosition(node: KetherNode, newNodeIds: Set<string>): boolean {
  if (newNodeIds.has(node.id)) return false
  const x = finite(node.position?.x, 0)
  const y = finite(node.position?.y, 0)
  return x !== 0 || y !== 0
}

function rectFor(node: KetherNode, size: Size): Rect {
  return {
    x: finite(node.position?.x),
    y: finite(node.position?.y),
    width: positive(size.width) ?? 1,
    height: positive(size.height) ?? 1,
  }
}

function overlaps(left: Rect, right: Rect, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y
}

function safePosition(position: { x: number; y: number } | undefined): { x: number; y: number } {
  return { x: finite(position?.x), y: finite(position?.y) }
}

function relevantLayoutValue(node: KetherNode): KetherNodeLayout | undefined {
  return node.data.layout
}

function relevantNodeChanged(before: KetherNode, after: KetherNode): boolean {
  return finite(before.position?.x) !== finite(after.position?.x)
    || finite(before.position?.y) !== finite(after.position?.y)
    || styleDimension(before.style?.width) !== styleDimension(after.style?.width)
    || styleDimension(before.style?.height) !== styleDimension(after.style?.height)
    || JSON.stringify(relevantLayoutValue(before)) !== JSON.stringify(relevantLayoutValue(after))
}

/** 稳定地把父节点移动到所有后代之前，不改变可满足约束的原始相对顺序。 */
export function normalizeParentFirstNodeOrder(nodes: KetherNode[]): KetherNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const state = new Map<string, "visiting" | "done">()
  const result: KetherNode[] = []

  const visit = (node: KetherNode) => {
    const current = state.get(node.id)
    if (current === "done" || current === "visiting") return
    state.set(node.id, "visiting")
    if (node.parentId) {
      const parent = nodeById.get(node.parentId)
      if (parent) visit(parent)
    }
    state.set(node.id, "done")
    result.push(node)
  }

  for (const node of nodes) visit(node)
  return result
}

/**
 * 对 Kether Flow 做无 DOM 的确定性布局。容器先递归计算后代尺寸，顶层再交给 dagre。
 */
export function layoutFlowGraph(
  nodes: KetherNode[],
  edges: KetherEdge[],
  options: FlowLayoutOptions = {},
): FlowLayoutResult {
  const mode = options.mode ?? "force"
  const lockedNodeIds = iterableSet(options.lockedNodeIds)
  const newNodeIds = iterableSet(options.newNodeIds)
  const nodeSeparation = positive(options.nodeSeparation) ?? DEFAULT_NODE_SEPARATION
  const rankSeparation = positive(options.rankSeparation) ?? DEFAULT_RANK_SEPARATION
  const slotGap = positive(options.slotGap) ?? DEFAULT_SLOT_GAP
  const satelliteGap = positive(options.satelliteGap) ?? DEFAULT_SATELLITE_GAP

  const originalById = new Map(nodes.map((node) => [node.id, node]))
  const workingNodes = nodes.map((node) => ({
    ...node,
    position: safePosition(node.position),
    style: { ...node.style },
    data: { ...node.data },
  } as KetherNode))
  const nodeById = new Map(workingNodes.map((node) => [node.id, node]))
  const directChildren = new Map<string, string[]>()
  for (const node of workingNodes) {
    if (!node.parentId || !nodeById.has(node.parentId)) continue
    const siblings = directChildren.get(node.parentId) ?? []
    siblings.push(node.id)
    directChildren.set(node.parentId, siblings)
  }

  const resolvedSizes = new Map<string, Size>()
  const resolving = new Set<string>()
  const shouldPreserve = (node: KetherNode) => mode === "preserve"
    && (lockedNodeIds.has(node.id) || hasManualPosition(node, newNodeIds))

  const layoutNode = (nodeId: string): Size => {
    const cached = resolvedSizes.get(nodeId)
    if (cached) return cached
    const node = nodeById.get(nodeId)
    if (!node) return { width: 1, height: 1 }
    if (resolving.has(nodeId)) {
      const fallback = getNodeSize(node)
      resolvedSizes.set(nodeId, fallback)
      return fallback
    }
    resolving.add(nodeId)

    const container = isContainer(node)
    // 容器的 measured/style 是上一轮布局的结果，不能把旧外框当成新的最小尺寸，
    // 否则删除子节点后容器永远无法收缩。容器最小尺寸由结构常量与子树重新计算。
    const baseSize = container ? fallbackNodeSize(node) : getNodeSize(node)
    const childIds = directChildren.get(node.id) ?? []
    for (const childId of childIds) layoutNode(childId)

    if (!isContainer(node)) {
      const size = {
        width: positive(baseSize.width) ?? 1,
        height: positive(baseSize.height) ?? 1,
      }
      resolvedSizes.set(node.id, size)
      resolving.delete(nodeId)
      return size
    }

    const slotNames = nodeSlotNames(node)
    if (slotNames.length === 0 && childIds.length > 0) slotNames.push("body")
    const assigned = new Set<string>()
    const slotChildren = new Map<string, string[]>()
    for (const slot of slotNames) {
      const declared = (node.data.slotChildren?.[slot] ?? [])
        .filter((id) => childIds.includes(id) && nodeById.has(id))
      declared.forEach((id) => assigned.add(id))
      slotChildren.set(slot, semanticOrder(declared, edges))
    }
    const unassigned = childIds.filter((id) => !assigned.has(id))
    if (unassigned.length > 0) {
      const fallbackSlot = slotNames[0] ?? "body"
      if (!slotNames.includes(fallbackSlot)) slotNames.push(fallbackSlot)
      slotChildren.set(fallbackSlot, [
        ...(slotChildren.get(fallbackSlot) ?? []),
        ...semanticOrder(unassigned, edges),
      ])
    }

    let containerWidth = positive(baseSize.width) ?? 1
    for (const ids of slotChildren.values()) {
      for (const childId of ids) {
        const child = nodeById.get(childId)
        const childSize = resolvedSizes.get(childId)
        if (!child || !childSize) continue
        const neededWidth = shouldPreserve(child)
          ? finite(child.position.x) + childSize.width + SLOT_OUTER_PADDING
          : childSize.width + (SLOT_OUTER_PADDING + SLOT_INNER_PADDING) * 2
        containerWidth = Math.max(containerWidth, neededWidth)
      }
    }

    let cursorY = CONTAINER_HEADER_HEIGHT
    const slotRects: Record<string, KetherSlotLayout> = {}
    for (const slot of slotNames) {
      const ids = slotChildren.get(slot) ?? []
      const slotX = SLOT_OUTER_PADDING
      const slotWidth = Math.max(1, containerWidth - SLOT_OUTER_PADDING * 2)
      const contentX = slotX + SLOT_INNER_PADDING
      const contentStartY = cursorY + SLOT_LABEL_HEIGHT + SLOT_INNER_PADDING
      let automaticY = contentStartY
      const lockedRects: Rect[] = []

      if (mode === "preserve") {
        for (const childId of ids) {
          const child = nodeById.get(childId)
          const childSize = resolvedSizes.get(childId)
          if (child && childSize && shouldPreserve(child)) lockedRects.push(rectFor(child, childSize))
        }
      }

      for (const childId of ids) {
        const child = nodeById.get(childId)
        const childSize = resolvedSizes.get(childId)
        if (!child || !childSize || shouldPreserve(child)) continue
        let candidate: Rect = { x: contentX, y: automaticY, ...childSize }
        for (let attempts = 0; attempts < lockedRects.length + ids.length + 4; attempts += 1) {
          const blockers = lockedRects.filter((rect) => overlaps(candidate, rect, slotGap))
          if (blockers.length === 0) break
          candidate = {
            ...candidate,
            y: Math.max(...blockers.map((rect) => rect.y + rect.height + slotGap)),
          }
        }
        child.position = { x: finite(candidate.x), y: finite(candidate.y) }
        automaticY = child.position.y + childSize.height + slotGap
      }

      const childRects = ids.flatMap((childId) => {
        const child = nodeById.get(childId)
        const childSize = resolvedSizes.get(childId)
        return child && childSize ? [rectFor(child, childSize)] : []
      })
      const childrenBottom = childRects.length > 0
        ? Math.max(...childRects.map((rect) => rect.y + rect.height))
        : contentStartY
      const slotBottom = Math.max(
        cursorY + MIN_SLOT_HEIGHT,
        childrenBottom + SLOT_INNER_PADDING,
      )
      const slotHeight = Math.max(1, slotBottom - cursorY)
      slotRects[slot] = {
        x: slotX,
        y: cursorY,
        width: slotWidth,
        height: slotHeight,
        contentX,
        contentY: contentStartY,
        contentWidth: Math.max(1, slotWidth - SLOT_INNER_PADDING * 2),
        contentHeight: Math.max(1, slotHeight - SLOT_LABEL_HEIGHT - SLOT_INNER_PADDING * 2),
      }
      cursorY = slotBottom + SLOT_OUTER_PADDING
    }

    const allChildRects = childIds.flatMap((childId) => {
      const child = nodeById.get(childId)
      const childSize = resolvedSizes.get(childId)
      return child && childSize ? [rectFor(child, childSize)] : []
    })
    if (allChildRects.length > 0) {
      containerWidth = Math.max(
        containerWidth,
        ...allChildRects.map((rect) => rect.x + rect.width + SLOT_OUTER_PADDING),
      )
    }
    const finalSlotWidth = Math.max(1, containerWidth - SLOT_OUTER_PADDING * 2)
    for (const slotLayout of Object.values(slotRects)) {
      slotLayout.width = finalSlotWidth
      slotLayout.contentWidth = Math.max(1, finalSlotWidth - SLOT_INNER_PADDING * 2)
    }
    const childrenBottom = allChildRects.length > 0
      ? Math.max(...allChildRects.map((rect) => rect.y + rect.height + CONTAINER_BOTTOM_PADDING))
      : 0
    const containerHeight = Math.max(
      positive(baseSize.height) ?? 1,
      cursorY + CONTAINER_BOTTOM_PADDING,
      childrenBottom,
    )
    const size = {
      width: positive(containerWidth) ?? 1,
      height: positive(containerHeight) ?? 1,
    }
    node.style = { ...node.style, width: size.width, height: size.height }
    node.data = {
      ...node.data,
      layout: {
        ...(node.data.layout ?? {}),
        width: size.width,
        height: size.height,
        headerHeight: CONTAINER_HEADER_HEIGHT,
        slots: slotRects,
      },
    }

    resolvedSizes.set(node.id, size)
    resolving.delete(nodeId)
    return size
  }

  for (const node of workingNodes) layoutNode(node.id)

  const topLevel = workingNodes.filter((node) => !node.parentId || !nodeById.has(node.parentId))
  const topLevelSet = new Set(topLevel.map((node) => node.id))
  const executionEdges = edges.filter(isExecutionEdge)
  const semanticExecutionEdges = executionEdges.filter(isSemanticExecutionEdge)
  const executionNodeIds = new Set(executionEdges.flatMap((edge) => [edge.source, edge.target]))
  const dataEdges = edges.filter(isDataEdge)
  const satelliteIds = new Set(topLevel
    .filter((node) => node.data.nodeKind === "data"
      && !executionNodeIds.has(node.id)
      && dataEdges.some((edge) => edge.source === node.id && nodeById.has(edge.target)))
    .map((node) => node.id))
  const mainNodes = topLevel.filter((node) => !satelliteIds.has(node.id))

  if (mainNodes.length > 0) {
    const graph = new dagre.graphlib.Graph()
    graph.setDefaultEdgeLabel(() => ({}))
    graph.setGraph({
      rankdir: "TB",
      nodesep: nodeSeparation,
      ranksep: rankSeparation,
      marginx: 0,
      marginy: 0,
    })
    for (const node of mainNodes) {
      const size = resolvedSizes.get(node.id) ?? getNodeSize(node)
      graph.setNode(node.id, size)
    }
    const mainIds = new Set(mainNodes.map((node) => node.id))
    for (const edge of semanticExecutionEdges) {
      if (mainIds.has(edge.source) && mainIds.has(edge.target)) graph.setEdge(edge.source, edge.target)
    }
    dagre.layout(graph)

    const occupied: Rect[] = []
    for (const node of mainNodes) {
      if (!shouldPreserve(node)) continue
      occupied.push(rectFor(node, resolvedSizes.get(node.id) ?? getNodeSize(node)))
    }
    for (const node of mainNodes) {
      if (shouldPreserve(node)) continue
      const layout = graph.node(node.id)
      const size = resolvedSizes.get(node.id) ?? getNodeSize(node)
      let candidate: Rect = {
        x: finite(layout?.x) - size.width / 2,
        y: finite(layout?.y) - size.height / 2,
        ...size,
      }
      if (mode === "preserve") {
        for (let attempts = 0; attempts < occupied.length + mainNodes.length + 4; attempts += 1) {
          const blockers = occupied.filter((rect) => overlaps(candidate, rect, nodeSeparation / 2))
          if (blockers.length === 0) break
          candidate = {
            ...candidate,
            y: Math.max(...blockers.map((rect) => rect.y + rect.height + rankSeparation)),
          }
        }
      }
      node.position = { x: finite(candidate.x), y: finite(candidate.y) }
      occupied.push(candidate)
    }
  }

  const absolutePosition = (nodeId: string, seen = new Set<string>()): { x: number; y: number } => {
    const node = nodeById.get(nodeId)
    if (!node || seen.has(nodeId)) return { x: 0, y: 0 }
    const own = safePosition(node.position)
    if (!node.parentId) return own
    seen.add(nodeId)
    const parent = absolutePosition(node.parentId, seen)
    return { x: finite(parent.x + own.x), y: finite(parent.y + own.y) }
  }

  const inputIndex = (target: KetherNode, edge: KetherEdge): number => {
    const handle = edge.targetHandle ?? edge.data?.targetPort
    const schemaIndex = target.data.schemaAction?.inputs.findIndex((input) => input.key === handle) ?? -1
    if (schemaIndex >= 0) return schemaIndex
    const keys = Object.keys(target.data.inputs ?? {})
    const keyIndex = handle ? keys.indexOf(handle) : -1
    return keyIndex >= 0 ? keyIndex : Number.MAX_SAFE_INTEGER
  }

  const satelliteGroups = new Map<string, Array<{ node: KetherNode; edge: KetherEdge }>>()
  for (const satelliteId of satelliteIds) {
    const node = nodeById.get(satelliteId)
    if (!node) continue
    const edge = dataEdges.find((candidate) => candidate.source === satelliteId && nodeById.has(candidate.target))
    if (!edge) continue
    const group = satelliteGroups.get(edge.target) ?? []
    group.push({ node, edge })
    satelliteGroups.set(edge.target, group)
  }

  const occupiedTopLevel = mainNodes.map((node) => rectFor(node, resolvedSizes.get(node.id) ?? getNodeSize(node)))
  for (const [targetId, group] of satelliteGroups) {
    const target = nodeById.get(targetId)
    if (!target) continue
    group.sort((left, right) => inputIndex(target, left.edge) - inputIndex(target, right.edge))
    const targetPosition = absolutePosition(target.id)
    const targetSize = resolvedSizes.get(target.id) ?? getNodeSize(target)
    const totalHeight = group.reduce((sum, entry, index) => {
      const size = resolvedSizes.get(entry.node.id) ?? getNodeSize(entry.node)
      return sum + size.height + (index > 0 ? nodeSeparation / 2 : 0)
    }, 0)
    let y = targetPosition.y + targetSize.height / 2 - totalHeight / 2

    for (const entry of group) {
      const node = entry.node
      const size = resolvedSizes.get(node.id) ?? getNodeSize(node)
      if (shouldPreserve(node)) {
        occupiedTopLevel.push(rectFor(node, size))
        y += size.height + nodeSeparation / 2
        continue
      }
      let candidate: Rect = {
        x: targetPosition.x - satelliteGap - size.width,
        y,
        ...size,
      }
      for (let attempts = 0; attempts < occupiedTopLevel.length + 4; attempts += 1) {
        const blockers = occupiedTopLevel.filter((rect) => overlaps(candidate, rect, nodeSeparation / 4))
        if (blockers.length === 0) break
        candidate = {
          ...candidate,
          x: Math.min(...blockers.map((rect) => rect.x - satelliteGap - size.width)),
        }
      }
      node.position = { x: finite(candidate.x), y: finite(candidate.y) }
      occupiedTopLevel.push(candidate)
      y += size.height + nodeSeparation / 2
    }
  }

  for (const node of workingNodes) {
    node.position = safePosition(node.position)
    if (node.style?.width !== undefined) {
      node.style.width = positive(styleDimension(node.style.width)) ?? positive(resolvedSizes.get(node.id)?.width) ?? 1
    }
    if (node.style?.height !== undefined) {
      node.style.height = positive(styleDimension(node.style.height)) ?? positive(resolvedSizes.get(node.id)?.height) ?? 1
    }
  }

  const normalized = normalizeParentFirstNodeOrder(workingNodes)
  const changedNodeIds = normalized
    .filter((node) => {
      const original = originalById.get(node.id)
      return !original || relevantNodeChanged(original, node)
    })
    .map((node) => node.id)
  const visualTopLevelIds = normalized
    .filter((node) => topLevelSet.has(node.id))
    .sort((left, right) => finite(left.position.y) - finite(right.position.y) || finite(left.position.x) - finite(right.position.x))
    .map((node) => node.id)

  return {
    nodes: normalized,
    changedNodeIds,
    topLevelNodeIds: visualTopLevelIds,
  }
}
