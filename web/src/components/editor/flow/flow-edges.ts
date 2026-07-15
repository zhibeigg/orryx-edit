import type { KetherEdge, KetherNode } from "./flow-types"

function isExecutionEdge(edge: KetherEdge): boolean {
  return edge.data?.kind === "execution" || (!edge.data?.kind && !edge.targetHandle)
}

function automaticTopLevelOrder(
  nodes: KetherNode[],
  edges: KetherEdge[],
  excludedNodeIds: ReadonlySet<string>,
): KetherNode[] {
  const topLevel = nodes.filter((node) => !node.parentId && !excludedNodeIds.has(node.id))
  const nodeById = new Map(topLevel.map((node) => [node.id, node]))
  const originalIndex = new Map(nodes.map((node, index) => [node.id, index]))
  const generated = edges.filter((edge) => (
    edge.data?.kind === "execution"
    && edge.data.generated === true
    && edge.data.semantic === true
  ))

  if (generated.length === 0) {
    return [...topLevel].sort((left, right) => (
      left.position.y - right.position.y
      || left.position.x - right.position.x
      || (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    ))
  }

  const outgoing = new Map<string, Array<{ target: string; order: number }>>()
  const incoming = new Map(topLevel.map((node) => [node.id, 0]))
  const referenced = new Set<string>()
  for (const edge of generated) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    referenced.add(edge.source)
    referenced.add(edge.target)
    const targets = outgoing.get(edge.source) ?? []
    targets.push({ target: edge.target, order: edge.data?.order ?? Number.MAX_SAFE_INTEGER })
    outgoing.set(edge.source, targets)
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
  }

  const queue = topLevel
    .filter((node) => referenced.has(node.id) && (incoming.get(node.id) ?? 0) === 0)
    .sort((left, right) => (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0))
    .map((node) => node.id)
  const ordered: KetherNode[] = []
  const visited = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id || visited.has(id)) continue
    const node = nodeById.get(id)
    if (!node) continue
    visited.add(id)
    ordered.push(node)
    const targets = [...(outgoing.get(id) ?? [])]
      .sort((left, right) => left.order - right.order || (originalIndex.get(left.target) ?? 0) - (originalIndex.get(right.target) ?? 0))
    for (const { target } of targets) {
      incoming.set(target, (incoming.get(target) ?? 0) - 1)
      if ((incoming.get(target) ?? 0) <= 0) queue.push(target)
    }
  }

  for (const node of topLevel) {
    if (referenced.has(node.id) && !visited.has(node.id)) {
      visited.add(node.id)
      ordered.push(node)
    }
  }

  const unreferenced = topLevel
    .filter((node) => !visited.has(node.id))
    .sort((left, right) => (
      left.position.y - right.position.y
      || left.position.x - right.position.x
      || (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    ))
  for (const node of unreferenced) {
    const insertionIndex = ordered.findIndex((current) => (
      node.position.y < current.position.y
      || (node.position.y === current.position.y && node.position.x < current.position.x)
    ))
    if (insertionIndex === -1) ordered.push(node)
    else ordered.splice(insertionIndex, 0, node)
  }
  return ordered
}

/**
 * 结构边和自动执行边完全由当前节点结构派生。节点增删后统一重建，
 * 避免 slotChildren、父子关系与画面连线出现漂移。
 */
export function rebuildGeneratedFlowEdges(nodes: KetherNode[], edges: KetherEdge[]): KetherEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const dataSourceIds = new Set(
    edges
      .filter((edge) => edge.data?.kind === "data" && nodeById.get(edge.source)?.data.nodeKind === "data")
      .map((edge) => edge.source),
  )
  const preservedEdges = edges.filter((edge) => !(
    edge.data?.generated === true
    && (edge.data.kind === "structure" || edge.data.kind === "execution")
  ))
  const generatedEdges: KetherEdge[] = []

  for (const parent of nodes) {
    for (const [slot, declaredIds] of Object.entries(parent.data.slotChildren ?? {})) {
      const childIds = declaredIds.filter((id) => nodeById.get(id)?.parentId === parent.id)
      const first = childIds[0]
      if (first) {
        generatedEdges.push({
          id: `structure:${parent.id}:${slot}:${first}`,
          source: parent.id,
          sourceHandle: `${slot}-out`,
          target: first,
          targetHandle: "flow-in",
          data: {
            kind: "structure",
            generated: true,
            semantic: false,
            scopeId: parent.id,
            slot,
            order: 0,
          },
        })
      }
      for (let index = 0; index < childIds.length - 1; index += 1) {
        const source = childIds[index]
        const target = childIds[index + 1]
        generatedEdges.push({
          id: `execution:${parent.id}:${slot}:${index}:${source}->${target}`,
          source,
          sourceHandle: "flow-out",
          target,
          targetHandle: "flow-in",
          data: {
            kind: "execution",
            generated: true,
            semantic: false,
            scopeId: parent.id,
            slot,
            order: index,
          },
        })
      }
    }
  }

  const hasManualSemanticExecution = preservedEdges.some((edge) => (
    isExecutionEdge(edge) && edge.data?.semantic !== false
  ))
  if (!hasManualSemanticExecution) {
    const topLevel = automaticTopLevelOrder(nodes, edges, dataSourceIds)
    for (let index = 0; index < topLevel.length - 1; index += 1) {
      const source = topLevel[index].id
      const target = topLevel[index + 1].id
      generatedEdges.push({
        id: `execution:script:top:${index}:${source}->${target}`,
        source,
        sourceHandle: "flow-out",
        target,
        targetHandle: "flow-in",
        data: {
          kind: "execution",
          generated: true,
          semantic: true,
          scopeId: "script",
          order: index,
        },
      })
    }
  }

  return [...preservedEdges, ...generatedEdges]
}
