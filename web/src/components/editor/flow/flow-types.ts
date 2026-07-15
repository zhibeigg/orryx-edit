import type { Node, Edge } from "@xyflow/react"
import type { SchemaAction } from "@/types/schema"
import type { ASTNode } from "@/lib/kether-ast"
import type { BlockDocument } from "@/lib/block-document"

export type KetherInputKind = "number" | "string" | "boolean" | "identifier" | "var_ref" | "lazy_ref" | "raw" | "block"

export interface KetherSlotLayout {
  x: number
  y: number
  width: number
  height: number
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
}

export interface KetherNodeLayout {
  width: number
  height: number
  headerHeight?: number
  slots?: Record<string, KetherSlotLayout>
}

export interface KetherNodeData extends Record<string, unknown> {
  label: string
  schemaAction: SchemaAction | null
  inputs: Record<string, unknown>
  inputKinds: Record<string, KetherInputKind>
  slotChildren: Record<string, string[]>
  layout?: KetherNodeLayout
  onSlotDrop?: (slot: string, payload: SchemaAction | { builtin: string }) => void
  onInputChange?: (key: string, value: unknown, kind?: KetherInputKind) => void
  provides?: Record<string, string>
  astRef?: ASTNode
  readOnly?: boolean
  order?: number
  documentBlockId?: string
  variantId?: string
  blockShape?: "command" | "reporter" | "predicate" | "container" | "raw"
  inputBlocks?: Record<string, string>
  rawSource?: string
  nodeKind: "action" | "branch" | "loop" | "data" | "set" | "calc" | "raw"
}

export interface KetherEdgeData extends Record<string, unknown> {
  kind: "execution" | "data" | "structure"
  sourcePort?: string
  targetPort?: string
  dataType?: string
  generated?: boolean
  semantic?: boolean
  scopeId?: string
  slot?: string
  order?: number
}

export type KetherNode = Node<KetherNodeData>
export type KetherEdge = Edge<KetherEdgeData>

export interface FlowState {
  nodes: KetherNode[]
  edges: KetherEdge[]
  /** React Flow 只是该文档的投影；执行顺序与嵌套关系来自 document。 */
  document?: BlockDocument
  readOnlyReasons?: string[]
}
