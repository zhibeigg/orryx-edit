import type { SchemaAction } from "@/types/schema"
import type { KetherEdge, KetherInputKind, KetherNode } from "./flow-types"

interface FlowSnapshotLike {
  nodes: KetherNode[]
  edges: KetherEdge[]
}

const layoutNodeKeys = ["position", "positionAbsolute", "measured", "width", "height", "style", "selected", "dragging"]
const transientDataKeys = ["layout", "onSlotDrop", "onInputChange"]
const transientEdgeKeys = ["selected"]

function withoutKeys(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result = { ...value }
  for (const key of keys) delete result[key]
  return result
}

/** 为 React Flow 展示节点派生瞬态交互回调，不污染可序列化的语义节点。 */
export function bindFlowNodeInteractions(
  nodes: KetherNode[],
  onSlotDrop: (nodeId: string, slot: string, payload: SchemaAction | { builtin: string }) => void,
  onInputChange: (nodeId: string, key: string, value: unknown, kind?: KetherInputKind) => void,
): KetherNode[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onSlotDrop: node.type === "branchNode" || node.type === "loopNode"
        ? (slot: string, payload: SchemaAction | { builtin: string }) => onSlotDrop(node.id, slot, payload)
        : undefined,
      onInputChange: (key: string, value: unknown, kind?: KetherInputKind) => onInputChange(node.id, key, value, kind),
    },
  }))
}

/** 仅保留会影响 Kether 文本语义的图数据，排除坐标、尺寸和选择态。 */
export function semanticFlowSnapshotKey(snapshot: FlowSnapshotLike): string {
  return JSON.stringify({
    nodes: snapshot.nodes.map((node) => {
      const semanticNode = withoutKeys(node as unknown as Record<string, unknown>, layoutNodeKeys)
      semanticNode.data = withoutKeys(node.data as unknown as Record<string, unknown>, transientDataKeys)
      return semanticNode
    }),
    edges: snapshot.edges.map((edge) => withoutKeys(edge as unknown as Record<string, unknown>, transientEdgeKeys)),
  })
}

export function hasSemanticFlowChange(current: FlowSnapshotLike, target: FlowSnapshotLike): boolean {
  return semanticFlowSnapshotKey(current) !== semanticFlowSnapshotKey(target)
}
