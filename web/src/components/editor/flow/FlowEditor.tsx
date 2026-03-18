import { useCallback, useEffect, useMemo, useRef } from "react"
import type React from "react"
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Connection, type OnConnect, type NodeTypes
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import type { KetherNode, KetherEdge } from "./flow-types"
import { astToFlow, flowToAst } from "@/lib/kether-flow"
import { parseKether, stringifyKether } from "@/lib/kether-ast"
import { NodePalette } from "./NodePalette"
import { ActionNode } from "./nodes/ActionNode"
import { DataNode } from "./nodes/DataNode"
import { CalcNode } from "./nodes/CalcNode"
import { SetNode } from "./nodes/SetNode"
import { BranchNode } from "./nodes/BranchNode"
import { LoopNode } from "./nodes/LoopNode"

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

export function FlowEditor({ value, onChange, schema }: FlowEditorProps) {
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())

  // 外部文本变更 → 同步到节点图（300ms 防抖）
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInternalChange = useRef(false)

  // AST 快照撤销栈
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])

  const pushUndo = useCallback((text: string) => {
    undoStack.current.push(text)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return
    redoStack.current.push(value)
    const prev = undoStack.current.pop()!
    isInternalChange.current = true
    onChange(prev)
  }, [value, onChange])

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push(value)
    const next = redoStack.current.pop()!
    isInternalChange.current = true
    onChange(next)
  }, [value, onChange])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault()
      if (e.shiftKey) handleRedo()
      else handleUndo()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault()
      handleRedo()
    }
  }, [handleUndo, handleRedo])

  // AST → Flow (initial only)
  const initialFlow = useMemo(() => {
    try {
      const ast = parseKether(value, schema as any)
      return astToFlow(ast, schema, positionsRef.current)
    } catch {
      return { nodes: [], edges: [] }
    }
  }, []) // intentionally empty deps - only for initial render

  const [nodes, setNodes, onNodesChange] = useNodesState<KetherNode>(initialFlow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<KetherEdge>(initialFlow.edges)

  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      try {
        const ast = parseKether(value, schema as any)
        const flow = astToFlow(ast, schema, positionsRef.current)
        setNodes(flow.nodes)
        setEdges(flow.edges)
      } catch { /* 解析失败时保持当前状态 */ }
    }, 300)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [value, schema, setNodes, setEdges])

  // 连线
  const onConnect: OnConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({
      ...conn,
      data: { sourcePort: conn.sourceHandle ?? "", targetPort: conn.targetHandle ?? "", dataType: "ANY" }
    }, eds))
  }, [setEdges])

  // 节点变更 → 同步文本
  const syncToText = useCallback(() => {
    for (const node of nodes) {
      positionsRef.current.set(node.id, { ...node.position })
    }
    try {
      const ast = flowToAst({ nodes, edges }, schema)
      const text = stringifyKether(ast)
      pushUndo(value)
      isInternalChange.current = true
      onChange(text)
    } catch { /* 忽略转换错误 */ }
  }, [nodes, edges, schema, onChange, pushUndo, value])

  // 拖放创建节点
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const data = event.dataTransfer.getData("application/kether-node")
    if (!data) return

    const parsed = JSON.parse(data)
    const reactFlowBounds = event.currentTarget.getBoundingClientRect()
    const position = {
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    }

    let newNode: KetherNode
    if ("builtin" in parsed) {
      const kind = parsed.builtin as string
      const nodeKind =
        kind === "if" || kind === "case" ? "branch" :
        kind === "for" ? "loop" :
        kind === "calc" ? "calc" :
        kind === "set" ? "set" : "action"
      const nodeType =
        kind === "if" || kind === "case" ? "branchNode" :
        kind === "for" ? "loopNode" :
        kind === "calc" ? "calcNode" :
        kind === "set" ? "setNode" : "actionNode"
      newNode = {
        id: `${kind}_${Date.now()}`,
        type: nodeType,
        position,
        data: { label: kind, schemaAction: null, inputs: {}, slotChildren: {}, nodeKind }
      }
    } else {
      const action = parsed as SchemaAction
      const inputs: Record<string, unknown> = {}
      for (const p of action.inputs) {
        if (p.default != null) inputs[p.key] = p.default
      }
      newNode = {
        id: `${action.name}_${Date.now()}`,
        type: "actionNode",
        position,
        data: { label: action.name, schemaAction: action, inputs, slotChildren: {}, nodeKind: "action" }
      }
    }

    setNodes(nds => [...nds, newNode])
  }, [setNodes])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  return (
    <div className="flex h-full" onKeyDown={onKeyDown} tabIndex={0}>
      <NodePalette schema={schema} onDragStart={() => {}} />
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={syncToText}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
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
