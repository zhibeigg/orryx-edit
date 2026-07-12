import type { Node, Edge } from "@xyflow/react"
import type { SchemaAction } from "@/types/schema"
import type { ASTNode } from "@/lib/kether-ast"

export interface KetherNodeData extends Record<string, unknown> {
  label: string
  schemaAction: SchemaAction | null
  inputs: Record<string, unknown>
  slotChildren: Record<string, string[]>
  onSlotDrop?: (slot: string, payload: SchemaAction | { builtin: string }) => void
  onInlineEdit?: () => void
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
