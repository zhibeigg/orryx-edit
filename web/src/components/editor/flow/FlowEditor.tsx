import { useEffect, useMemo, useRef } from "react"
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, ReactFlowProvider,
  type NodeTypes
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { ActionsSchemaV2 } from "@/types/schema"
import type { ActionsSchema } from "@/lib/kether-ast"
import type { KetherNode, KetherEdge } from "./flow-types"
import { astToFlow } from "@/lib/kether-flow"
import { parseKether } from "@/lib/kether-ast"
import { ActionNode } from "./nodes/ActionNode"
import { DataNode } from "./nodes/DataNode"
import { CalcNode } from "./nodes/CalcNode"
import { SetNode } from "./nodes/SetNode"
import { BranchNode } from "./nodes/BranchNode"
import { LoopNode } from "./nodes/LoopNode"
import { SchemaProvider } from "./SchemaContext"
import { Eye } from "lucide-react"

const nodeTypes: NodeTypes = {
  actionNode: ActionNode,
  dataNode: DataNode,
  calcNode: CalcNode,
  setNode: SetNode,
  branchNode: BranchNode,
  loopNode: LoopNode,
}

interface FlowEditorProps {
  value: string
  onChange: (value: string) => void
  schema: ActionsSchemaV2
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <SchemaProvider value={props.schema}>
        <FlowEditorInner {...props} />
      </SchemaProvider>
    </ReactFlowProvider>
  )
}

function FlowEditorInner({ value, schema }: FlowEditorProps) {
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AST → Flow (initial)
  const initialFlow = useMemo(() => {
    try {
      const ast = parseKether(value, schema as ActionsSchema)
      return astToFlow(ast, schema, positionsRef.current)
    } catch {
      return { nodes: [], edges: [] }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState<KetherNode>(initialFlow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<KetherEdge>(initialFlow.edges)

  // 文本变更 → 单向同步到节点图（只读，不回写）
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      try {
        const ast = parseKether(value, schema as ActionsSchema)
        const flow = astToFlow(ast, schema, positionsRef.current)
        setNodes(flow.nodes)
        setEdges(flow.edges)
      } catch { /* 解析失败时保持当前状态 */ }
    }, 300)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [value, schema, setNodes, setEdges])

  // 拖动节点时保存位置（仅用于布局记忆，不回写文本）
  const onNodeDragStop = (_: unknown, node: KetherNode) => {
    positionsRef.current.set(node.id, { ...node.position })
  }

  return (
    <div className="flex h-full relative">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 rounded bg-[#252526]/90 border border-[#3c3c3c] text-[11px] text-[#858585]">
        <Eye className="w-3 h-3" />
        只读视图
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          fitView
          className="bg-[#1e1e1e]"
        >
          <Background color="#333" gap={20} />
          <Controls />
          <MiniMap nodeColor={() => "#3b82f6"} style={{ background: "#252526" }} />
        </ReactFlow>
      </div>
    </div>
  )
}
