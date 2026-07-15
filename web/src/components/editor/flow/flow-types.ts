import type { Node, Edge } from "@xyflow/react"
import type { SchemaAction } from "@/types/schema"
import type { ASTNode } from "@/lib/kether-ast"

export type KetherInputKind = "number" | "string" | "boolean" | "identifier" | "var_ref" | "lazy_ref"

export interface KetherNodeData extends Record<string, unknown> {
  label: string
  schemaAction: SchemaAction | null
  inputs: Record<string, unknown>
  inputKinds: Record<string, KetherInputKind>
  slotChildren: Record<string, string[]>
  onSlotDrop?: (slot: string, payload: SchemaAction | { builtin: string }) => void
  onInputChange?: (key: string, value: unknown, kind?: KetherInputKind) => void
  provides?: Record<string, string>
  astRef?: ASTNode
  readOnly?: boolean
  nodeKind: "action" | "branch" | "loop" | "data" | "set" | "calc"
}

export interface KetherEdgeData extends Record<string, unknown> {
  kind: "execution" | "data"
  sourcePort?: string
  targetPort?: string
  dataType?: string
}

export type KetherNode = Node<KetherNodeData>
export type KetherEdge = Edge<KetherEdgeData>

export interface FlowState {
  nodes: KetherNode[]
  edges: KetherEdge[]
  readOnlyReasons?: string[]
}
