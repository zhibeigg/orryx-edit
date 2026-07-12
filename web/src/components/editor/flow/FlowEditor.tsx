import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  addEdge, applyEdgeChanges, applyNodeChanges,
  useNodesState, useEdgesState, useReactFlow, ReactFlowProvider,
  type Connection, type EdgeChange, type NodeChange, type NodeTypes
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { ActionsSchemaV2 } from "@/types/schema"
import { stringifyKether, type ActionsSchema } from "@/lib/kether-ast"
import type { KetherNode, KetherEdge } from "./flow-types"
import { astToFlow, flowToAst } from "@/lib/kether-flow"
import { parseKether } from "@/lib/kether-ast"
import { ActionNode } from "./nodes/ActionNode"
import { DataNode } from "./nodes/DataNode"
import { CalcNode } from "./nodes/CalcNode"
import { SetNode } from "./nodes/SetNode"
import { BranchNode } from "./nodes/BranchNode"
import { LoopNode } from "./nodes/LoopNode"
import { SchemaProvider } from "./SchemaContext"
import { BookmarkPlus, History, Link2, Sparkles, Undo2, Redo2, X } from "lucide-react"
import { NodePalette } from "./NodePalette"
import type { SchemaAction } from "@/types/schema"

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

interface FlowSnapshot {
  nodes: KetherNode[]
  edges: KetherEdge[]
}

interface HistoryEntry {
  snapshot: FlowSnapshot
  label: string
}

interface TimelineGroup {
  label: string
  count: number
  steps: number
  category: HistoryCategory
}

interface HistoryCheckpoint {
  id: string
  name: string
  snapshot: FlowSnapshot
}

interface SerializedCheckpoint {
  name: string
  snapshot: FlowSnapshot
}

type HistoryCategory = "structure" | "params" | "connections" | "layout" | "other"
type HistoryFilter = "all" | HistoryCategory

function includesHistoryQuery(label: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true
  return label.toLowerCase().includes(trimmed)
}

function isBuiltinPayload(payload: unknown): payload is { builtin: string } {
  if (!payload || typeof payload !== "object") return false
  return typeof (payload as { builtin?: unknown }).builtin === "string"
}

function normalizeSnapshotNodes(nodes: KetherNode[]): KetherNode[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onSlotDrop: undefined,
      onInlineEdit: undefined,
    },
  }))
}

function cloneSnapshot(nodes: KetherNode[], edges: KetherEdge[]): FlowSnapshot {
  return {
    nodes: normalizeSnapshotNodes(nodes).map((node) => ({ ...node, data: { ...node.data } })),
    edges: edges.map((edge) => ({ ...edge })),
  }
}

function snapshotKey(snapshot: FlowSnapshot): string {
  return JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges })
}

function getNodeChangeLabel(changes: NodeChange<KetherNode>[]): string {
  if (changes.some((change) => change.type === "remove")) return "删除节点"
  if (changes.some((change) => change.type === "add")) return "添加节点"
  if (changes.some((change) => change.type === "replace")) return "替换节点"
  if (changes.some((change) => change.type === "position")) return "移动节点"
  return "编辑节点"
}

function getEdgeChangeLabel(changes: EdgeChange<KetherEdge>[]): string {
  if (changes.some((change) => change.type === "remove")) return "删除连线"
  if (changes.some((change) => change.type === "add")) return "添加连线"
  if (changes.some((change) => change.type === "replace")) return "替换连线"
  return "编辑连线"
}

function getHistoryCategory(label: string): HistoryCategory {
  if (label.includes("连线")) return "connections"
  if (label.includes("参数")) return "params"
  if (label.includes("移动") || label.includes("布局")) return "layout"
  if (label.includes("节点") || label.includes("子节点")) return "structure"
  return "other"
}

function groupTimeline(entries: HistoryEntry[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  let cumulative = 0

  for (const entry of entries) {
    const category = getHistoryCategory(entry.label)
    const last = groups[groups.length - 1]
    if (last && last.label === entry.label && last.category === category) {
      last.count += 1
      cumulative += 1
      last.steps = cumulative
      continue
    }

    cumulative += 1
    groups.push({ label: entry.label, count: 1, steps: cumulative, category })
  }

  return groups
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFlowSnapshot(value: unknown): value is FlowSnapshot {
  if (!isPlainObject(value)) return false
  const nodes = value.nodes
  const edges = value.edges
  return Array.isArray(nodes) && Array.isArray(edges)
}

function parseImportedCheckpoints(value: unknown): SerializedCheckpoint[] {
  if (!Array.isArray(value)) return []
  const result: SerializedCheckpoint[] = []

  for (const item of value) {
    if (!isPlainObject(item)) continue
    const name = item.name
    const snapshot = item.snapshot
    if (typeof name !== "string" || !isFlowSnapshot(snapshot)) continue
    const nextName = name.trim()
    if (!nextName) continue
    result.push({ name: nextName, snapshot: cloneSnapshot(snapshot.nodes, snapshot.edges) })
  }

  return result
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

function FlowEditorInner({ value, onChange, schema }: FlowEditorProps) {
  const idCounterRef = useRef(0)
  const flowRootRef = useRef<HTMLDivElement | null>(null)
  const checkpointImportRef = useRef<HTMLInputElement | null>(null)
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInternalYamlRef = useRef<string | null>(null)
  const nodesRef = useRef<KetherNode[]>([])
  const edgesRef = useRef<KetherEdge[]>([])
  const suppressNodeSyncRef = useRef(false)
  const restoringRef = useRef(false)
  const draggingRef = useRef(false)
  const inlineMergeActiveRef = useRef(false)
  const inlineMergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyPastRef = useRef<HistoryEntry[]>([])
  const historyFutureRef = useRef<HistoryEntry[]>([])
  const historyKeyRef = useRef("")
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [undoLabel, setUndoLabel] = useState<string | null>(null)
  const [redoLabel, setRedoLabel] = useState<string | null>(null)
  const [undoTimeline, setUndoTimeline] = useState<HistoryEntry[]>([])
  const [redoTimeline, setRedoTimeline] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all")
  const [historyQuery, setHistoryQuery] = useState("")
  const [checkpoints, setCheckpoints] = useState<HistoryCheckpoint[]>([])
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null)
  const [editingCheckpointName, setEditingCheckpointName] = useState("")

  const undoGroups = useMemo(() => groupTimeline(undoTimeline), [undoTimeline])
  const redoGroups = useMemo(() => groupTimeline(redoTimeline), [redoTimeline])
  const visibleUndoGroups = useMemo(
    () => (historyFilter === "all" ? undoGroups : undoGroups.filter((group) => group.category === historyFilter))
      .filter((group) => includesHistoryQuery(group.label, historyQuery)),
    [undoGroups, historyFilter, historyQuery]
  )
  const visibleRedoGroups = useMemo(
    () => (historyFilter === "all" ? redoGroups : redoGroups.filter((group) => group.category === historyFilter))
      .filter((group) => includesHistoryQuery(group.label, historyQuery)),
    [redoGroups, historyFilter, historyQuery]
  )

  const nextNodeId = useCallback((prefix: string) => {
    idCounterRef.current += 1
    return `${prefix}_${Date.now()}_${idCounterRef.current}`
  }, [])

  // 初始节点和边为空，在useEffect中设置
  const [nodes, setNodes] = useNodesState<KetherNode>([])
  const [edges, setEdges] = useEdgesState<KetherEdge>([])
  const { screenToFlowPosition } = useReactFlow<KetherNode, KetherEdge>()

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  const pushToText = useCallback((nextNodes: KetherNode[], nextEdges: KetherEdge[]) => {
    historyKeyRef.current = snapshotKey(cloneSnapshot(nextNodes, nextEdges))
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current)
    emitTimerRef.current = setTimeout(() => {
      try {
        const ast = flowToAst({ nodes: nextNodes, edges: nextEdges }, schema)
        const text = stringifyKether(ast)
        if (text !== value) {
          lastInternalYamlRef.current = text
          onChange(text)
        }
      } catch {
        return
      }
    }, 220)
  }, [onChange, schema, value])

  const refreshHistoryState = useCallback(() => {
    setCanUndo(historyPastRef.current.length > 0)
    setCanRedo(historyFutureRef.current.length > 0)
    setUndoLabel(historyPastRef.current.length > 0 ? historyPastRef.current[historyPastRef.current.length - 1].label : null)
    setRedoLabel(historyFutureRef.current.length > 0 ? historyFutureRef.current[0].label : null)
    setUndoTimeline([...historyPastRef.current].slice(-18).reverse())
    setRedoTimeline(historyFutureRef.current.slice(0, 18))
  }, [])

  const resetHistory = useCallback((nodesValue: KetherNode[], edgesValue: KetherEdge[]) => {
    historyPastRef.current = []
    historyFutureRef.current = []
    historyKeyRef.current = snapshotKey(cloneSnapshot(nodesValue, edgesValue))
    refreshHistoryState()
  }, [refreshHistoryState])

  const rememberBeforeChange = useCallback((label: string) => {
    if (restoringRef.current) return
    const snap = cloneSnapshot(nodesRef.current, edgesRef.current)
    const key = snapshotKey(snap)
    const last = historyPastRef.current[historyPastRef.current.length - 1]
    if (last && snapshotKey(last.snapshot) === key) return
    historyPastRef.current.push({ snapshot: snap, label })
    if (historyPastRef.current.length > 120) historyPastRef.current.shift()
    historyFutureRef.current = []
    refreshHistoryState()
  }, [refreshHistoryState])

  const notifyInlineEdit = useCallback(() => {
    if (restoringRef.current || draggingRef.current) return
    if (!inlineMergeActiveRef.current) {
      inlineMergeActiveRef.current = true
      rememberBeforeChange("编辑参数")
    }
    if (inlineMergeTimerRef.current) clearTimeout(inlineMergeTimerRef.current)
    inlineMergeTimerRef.current = setTimeout(() => {
      inlineMergeActiveRef.current = false
    }, 420)
  }, [rememberBeforeChange])

  const restoreSnapshot = useCallback((snapshot: FlowSnapshot) => {
    restoringRef.current = true
    suppressNodeSyncRef.current = true
    const nodesValue = cloneSnapshot(snapshot.nodes, snapshot.edges).nodes
    const edgesValue = cloneSnapshot(snapshot.nodes, snapshot.edges).edges
    setNodes(nodesValue)
    setEdges(edgesValue)
    nodesRef.current = nodesValue
    edgesRef.current = edgesValue
    pushToText(nodesValue, edgesValue)
    queueMicrotask(() => {
      restoringRef.current = false
    })
  }, [setEdges, setNodes, pushToText])

  const executeUndoStep = useCallback(() => {
    if (historyPastRef.current.length === 0) return false
    const current = cloneSnapshot(nodesRef.current, edgesRef.current)
    const previous = historyPastRef.current.pop()
    if (!previous) return false
    historyFutureRef.current.unshift({ snapshot: current, label: previous.label })
    historyKeyRef.current = snapshotKey(previous.snapshot)
    restoreSnapshot(previous.snapshot)
    inlineMergeActiveRef.current = false
    return true
  }, [restoreSnapshot])

  const executeRedoStep = useCallback(() => {
    if (historyFutureRef.current.length === 0) return false
    const next = historyFutureRef.current.shift()
    if (!next) return false
    const current = cloneSnapshot(nodesRef.current, edgesRef.current)
    historyPastRef.current.push({ snapshot: current, label: next.label })
    historyKeyRef.current = snapshotKey(next.snapshot)
    restoreSnapshot(next.snapshot)
    inlineMergeActiveRef.current = false
    return true
  }, [restoreSnapshot])

  const undo = useCallback(() => {
    if (!executeUndoStep()) return
    refreshHistoryState()
  }, [executeUndoStep, refreshHistoryState])

  const redo = useCallback(() => {
    if (!executeRedoStep()) return
    refreshHistoryState()
  }, [executeRedoStep, refreshHistoryState])

  const undoMany = useCallback((steps: number) => {
    let changed = false
    for (let index = 0; index < steps; index += 1) {
      if (!executeUndoStep()) break
      changed = true
    }
    if (changed) refreshHistoryState()
  }, [executeUndoStep, refreshHistoryState])

  const redoMany = useCallback((steps: number) => {
    let changed = false
    for (let index = 0; index < steps; index += 1) {
      if (!executeRedoStep()) break
      changed = true
    }
    if (changed) refreshHistoryState()
  }, [executeRedoStep, refreshHistoryState])

  const createCheckpoint = useCallback(() => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false })
    const next: HistoryCheckpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `检查点 ${timestamp}`,
      snapshot: cloneSnapshot(nodesRef.current, edgesRef.current),
    }
    setCheckpoints((current) => {
      const merged = [next, ...current]
      return merged.slice(0, 12)
    })
  }, [])

  const jumpToCheckpoint = useCallback((checkpoint: HistoryCheckpoint) => {
    rememberBeforeChange("跳转检查点")
    restoreSnapshot(checkpoint.snapshot)
    refreshHistoryState()
  }, [rememberBeforeChange, restoreSnapshot, refreshHistoryState])

  const removeCheckpoint = useCallback((id: string) => {
    setCheckpoints((current) => current.filter((item) => item.id !== id))
    setEditingCheckpointId((current) => (current === id ? null : current))
  }, [])

  const exportCheckpoints = useCallback(() => {
    if (checkpoints.length === 0) return
    const payload = checkpoints.map((item) => ({ name: item.name, snapshot: item.snapshot }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `flow-checkpoints-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [checkpoints])

  const openImportCheckpoints = useCallback(() => {
    checkpointImportRef.current?.click()
  }, [])

  const onImportCheckpoints = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseImportedCheckpoints(JSON.parse(text))
      if (parsed.length > 0) {
        setCheckpoints((current) => {
          const imported = parsed.map((item) => ({
            id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: item.name,
            snapshot: item.snapshot,
          }))
          return [...imported, ...current].slice(0, 12)
        })
      }
    } catch {
      return
    } finally {
      event.target.value = ""
    }
  }, [])

  const startRenameCheckpoint = useCallback((checkpoint: HistoryCheckpoint) => {
    setEditingCheckpointId(checkpoint.id)
    setEditingCheckpointName(checkpoint.name)
  }, [])

  const cancelRenameCheckpoint = useCallback(() => {
    setEditingCheckpointId(null)
    setEditingCheckpointName("")
  }, [])

  const commitRenameCheckpoint = useCallback((id: string) => {
    const nextName = editingCheckpointName.trim()
    if (!nextName) {
      cancelRenameCheckpoint()
      return
    }
    setCheckpoints((current) => current.map((item) => (item.id === id ? { ...item, name: nextName } : item)))
    cancelRenameCheckpoint()
  }, [editingCheckpointName, cancelRenameCheckpoint])

  useEffect(() => {
    if (suppressNodeSyncRef.current) {
      suppressNodeSyncRef.current = false
      return
    }
    if (nodesRef.current.length === 0 && edgesRef.current.length === 0) return
    pushToText(nodes, edgesRef.current)
  }, [nodes, pushToText])

  const handleNodesChange = useCallback((changes: NodeChange<KetherNode>[]) => {
    if (changes.length === 0) return
    if (!draggingRef.current) {
      rememberBeforeChange(getNodeChangeLabel(changes))
    }
    inlineMergeActiveRef.current = false
    setNodes((current) => {
      const next = applyNodeChanges(changes, current)
      const removed = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id)
      )
      if (removed.size > 0) {
        setEdges((currentEdges) => {
          const filteredEdges = currentEdges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
          edgesRef.current = filteredEdges
          return filteredEdges
        })
      }
      pushToText(next, edgesRef.current)
      return next
    })
  }, [rememberBeforeChange, setEdges, setNodes, pushToText])

  const handleEdgesChange = useCallback((changes: EdgeChange<KetherEdge>[]) => {
    if (changes.length === 0) return
    rememberBeforeChange(getEdgeChangeLabel(changes))
    inlineMergeActiveRef.current = false
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current)
      edgesRef.current = next
      pushToText(nodesRef.current, next)
      return next
    })
  }, [rememberBeforeChange, setEdges, pushToText])

  const handleConnect = useCallback((connection: Connection) => {
    rememberBeforeChange("创建连线")
    inlineMergeActiveRef.current = false
    setEdges((current) => {
      const next = addEdge(
        {
          ...connection,
          id: `${connection.source ?? "src"}-${connection.target ?? "dst"}-${Date.now()}`,
          animated: true,
          style: { stroke: "#38bdf8", strokeWidth: 1.5 },
        },
        current
      )
      edgesRef.current = next
      pushToText(nodesRef.current, next)
      return next
    })
  }, [rememberBeforeChange, setEdges, pushToText])

  const createActionNode = useCallback((action: SchemaAction, x: number, y: number): KetherNode => {
    const inputs = Object.fromEntries((action.inputs ?? []).map((item) => [item.key, item.default ?? ""]))
    return {
      id: nextNodeId("action"),
      type: "actionNode",
      position: { x, y },
      data: {
        label: action.name,
        schemaAction: action,
        inputs,
        slotChildren: {},
        onSlotDrop: undefined,
        nodeKind: "action",
      },
    }
  }, [nextNodeId])

  const createBuiltinNode = useCallback((builtin: string, x: number, y: number): KetherNode | null => {
    switch (builtin) {
      case "set":
        return {
          id: nextNodeId("set"),
          type: "setNode",
          position: { x, y },
          data: { label: "set", schemaAction: null, inputs: { variable: "x", value: "" }, slotChildren: {}, onSlotDrop: undefined, nodeKind: "set" },
        }
      case "if":
      case "case":
        return {
          id: nextNodeId("branch"),
          type: "branchNode",
          position: { x, y },
          data: {
            label: builtin,
            schemaAction: null,
            inputs: { condition: "true" },
            slotChildren: { then: [], else: [] },
            onSlotDrop: undefined,
            nodeKind: "branch",
          },
        }
      case "for":
        return {
          id: nextNodeId("loop"),
          type: "loopNode",
          position: { x, y },
          data: {
            label: "for",
            schemaAction: null,
            inputs: { variable: "i", iterable: "&list" },
            slotChildren: { body: [] },
            onSlotDrop: undefined,
            nodeKind: "loop",
            provides: { i: "i" },
          },
        }
      case "calc":
        return {
          id: nextNodeId("calc"),
          type: "calcNode",
          position: { x, y },
          data: { label: "calc", schemaAction: null, inputs: { formula: "" }, slotChildren: {}, onSlotDrop: undefined, nodeKind: "calc" },
        }
      default:
        return null
    }
  }, [nextNodeId])

  const createNodeFromPayload = useCallback((payload: SchemaAction | { builtin: string }, x: number, y: number) => {
    if (isBuiltinPayload(payload)) return createBuiltinNode(payload.builtin, x, y)
    return createActionNode(payload, x, y)
  }, [createActionNode, createBuiltinNode])

  const handleSlotDrop = useCallback((parentId: string, slot: string, payload: SchemaAction | { builtin: string }) => {
    rememberBeforeChange("插入子节点")
    inlineMergeActiveRef.current = false
    setNodes((current) => {
      const parent = current.find((node) => node.id === parentId)
      if (!parent) return current

      const parentData = parent.data
      const existing = parentData.slotChildren[slot] ?? []
      const nextNode = createNodeFromPayload(payload, 24, 96 + existing.length * 86)
      if (!nextNode) return current

      const childNode: KetherNode = {
        ...nextNode,
        parentId,
        position: nextNode.position,
      }

      const nextNodes = current.map((node) => {
        if (node.id !== parentId) return node
        return {
          ...node,
          data: {
            ...node.data,
            slotChildren: {
              ...node.data.slotChildren,
              [slot]: [...existing, childNode.id],
            },
          },
        }
      })

      nextNodes.push(childNode)
      pushToText(nextNodes, edgesRef.current)
      return nextNodes
    })
  }, [createNodeFromPayload, rememberBeforeChange, setNodes, pushToText])

  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        const needsSlotDrop = (node.type === "branchNode" || node.type === "loopNode") && typeof node.data.onSlotDrop !== "function"
        const needsInlineEdit = typeof node.data.onInlineEdit !== "function"
        if (!needsSlotDrop && !needsInlineEdit) return node
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            onSlotDrop: node.type === "branchNode" || node.type === "loopNode"
              ? (slot: string, payload: SchemaAction | { builtin: string }) => handleSlotDrop(node.id, slot, payload)
              : undefined,
            onInlineEdit: notifyInlineEdit,
          },
        }
      })
      return changed ? next : current
    })
  }, [setNodes, handleSlotDrop, notifyInlineEdit])

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData("application/kether-node")
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as SchemaAction | { builtin: string }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const nextNode = isBuiltinPayload(payload)
        ? createBuiltinNode(payload.builtin, position.x, position.y)
        : createActionNode(payload, position.x, position.y)
      if (!nextNode) return
      rememberBeforeChange("添加节点")
      inlineMergeActiveRef.current = false
      setNodes((current) => {
        const next = [...current, nextNode]
        pushToText(next, edgesRef.current)
        return next
      })
    } catch {
      return
    }
  }, [createActionNode, createBuiltinNode, rememberBeforeChange, screenToFlowPosition, setNodes, pushToText])

  // 初始化和更新节点图
  useEffect(() => {
    if (lastInternalYamlRef.current && value === lastInternalYamlRef.current) {
      lastInternalYamlRef.current = null
      return
    }
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current)
    parseTimerRef.current = setTimeout(() => {
      try {
        const ast = parseKether(value, schema as unknown as ActionsSchema)
        const flow = astToFlow(ast, schema, positionsRef.current)
        suppressNodeSyncRef.current = true
        inlineMergeActiveRef.current = false
        setNodes(flow.nodes)
        setEdges(flow.edges)
        nodesRef.current = flow.nodes
        edgesRef.current = flow.edges
        resetHistory(flow.nodes, flow.edges)
      } catch { /* 解析失败时保持当前状态 */ }
    }, 0) // 使用0ms超时确保在渲染后执行
    return () => { if (parseTimerRef.current) clearTimeout(parseTimerRef.current) }
  }, [value, schema, setNodes, setEdges, resetHistory])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const root = flowRootRef.current
      if (!root) return
      const target = event.target as Node | null
      if (target && !root.contains(target)) return

      const ctrl = event.ctrlKey || event.metaKey
      if (!ctrl) return

      if (!event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault()
        undo()
        return
      }

      if ((event.shiftKey && event.key.toLowerCase() === "z") || event.key.toLowerCase() === "y") {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [undo, redo])

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current)
      if (inlineMergeTimerRef.current) clearTimeout(inlineMergeTimerRef.current)
    }
  }, [])

  // 拖动节点时保存位置（仅用于布局记忆，不回写文本）
  const onNodeDragStop = (_: unknown, node: KetherNode) => {
    draggingRef.current = false
    inlineMergeActiveRef.current = false
    positionsRef.current.set(node.id, { ...node.position })
  }

  const onNodeDragStart = () => {
    if (draggingRef.current) return
    draggingRef.current = true
    rememberBeforeChange("移动节点")
  }

  return (
    <div ref={flowRootRef} className="flex h-full max-md:flex-col bg-[radial-gradient(circle_at_top_left,#243447_0%,#1c1f24_35%,#17191d_100%)]">
      <NodePalette schema={schema} onDragStart={() => {}} />
      <div className="flex-1 min-w-0 relative">
        <div className="h-8 px-3 border-b border-[#2f3136] bg-[#1b1d22]/95 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-[#a6adbb]">
            <Sparkles className="w-3.5 h-3.5 text-[#56b6c2]" />
            拖拽左侧节点到画布，连线后将自动同步到脚本文本
          </div>
          <div className="flex items-center gap-1 text-[#7f8795]">
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors ${showHistory ? "border-[#5b95d7] text-[#dce8f8] bg-[#253244]" : "border-[#2f3136] text-[#aab2c0] hover:bg-[#242933] hover:text-[#dde4f0]"}`}
              title="历史时间线"
            >
              <History className="w-3 h-3" />
              历史
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="inline-flex items-center gap-1 rounded-md border border-[#2f3136] px-2 py-0.5 text-[10px] text-[#aab2c0] enabled:hover:bg-[#242933] enabled:hover:text-[#dde4f0] disabled:opacity-45 disabled:cursor-not-allowed"
              title={undoLabel ? `撤销 ${undoLabel} (Ctrl+Z)` : "撤销 (Ctrl+Z)"}
            >
              <Undo2 className="w-3 h-3" />
              撤销
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="inline-flex items-center gap-1 rounded-md border border-[#2f3136] px-2 py-0.5 text-[10px] text-[#aab2c0] enabled:hover:bg-[#242933] enabled:hover:text-[#dde4f0] disabled:opacity-45 disabled:cursor-not-allowed"
              title={redoLabel ? `重做 ${redoLabel} (Ctrl+Y / Ctrl+Shift+Z)` : "重做 (Ctrl+Y / Ctrl+Shift+Z)"}
            >
              <Redo2 className="w-3 h-3" />
              重做
            </button>
            <Link2 className="w-3 h-3" />
            已启用连接与回写
          </div>
        </div>
        {showHistory && (
          <div className="absolute z-20 top-10 right-3 w-64 rounded-lg border border-[#2f3136] bg-[#171a21]/95 shadow-[0_16px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm">
            <input
              ref={checkpointImportRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={onImportCheckpoints}
            />
            <div className="px-3 py-2 border-b border-[#2f3136] text-[11px] font-medium text-[#d8dee9]">历史时间线</div>
            <div className="px-2 py-2 border-b border-[#2f3136]">
              <button
                type="button"
                onClick={createCheckpoint}
                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md border border-[#2f3136] text-[11px] text-[#cfe0f8] bg-[#253244] hover:bg-[#2b3a51] transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                保存检查点
              </button>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={exportCheckpoints}
                  disabled={checkpoints.length === 0}
                  className="px-2 py-1 rounded-md border border-[#2f3136] text-[10px] text-[#b8c8df] enabled:hover:bg-[#222d3b] enabled:hover:text-[#e5edf8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  导出
                </button>
                <button
                  type="button"
                  onClick={openImportCheckpoints}
                  className="px-2 py-1 rounded-md border border-[#2f3136] text-[10px] text-[#b8c8df] hover:bg-[#222d3b] hover:text-[#e5edf8] transition-colors"
                >
                  导入
                </button>
              </div>
            </div>
            <div className="px-2 py-2 border-b border-[#2f3136]">
              <input
                type="text"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索动作..."
                className="w-full px-2 py-1 rounded-md border border-[#2f3136] bg-[#11151c] text-[11px] text-[#d9e2ef] placeholder:text-[#6e7c92] focus:outline-none focus:ring-1 focus:ring-[#5b95d7]"
              />
            </div>
            <div className="px-2 py-2 border-b border-[#2f3136] flex flex-wrap gap-1">
              {([
                ["all", "全部"],
                ["structure", "结构"],
                ["params", "参数"],
                ["connections", "连线"],
                ["layout", "布局"],
              ] as Array<[HistoryFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHistoryFilter(value)}
                  className={`px-2 py-1 rounded-md text-[10px] border transition-colors ${historyFilter === value ? "border-[#5b95d7] text-[#dce8f8] bg-[#253244]" : "border-[#2f3136] text-[#8ea2be] hover:text-[#dbe8f8] hover:bg-[#222d3b]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.14em] text-[#7f8ca0]">检查点</div>
                <div className="space-y-1">
                  {checkpoints.length === 0 && (
                    <div className="px-2 py-1.5 text-[10px] text-[#6f7b8f]">暂无检查点</div>
                  )}
                  {checkpoints.map((checkpoint) => (
                    <div key={checkpoint.id} className="flex items-center gap-1">
                      {editingCheckpointId === checkpoint.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingCheckpointName}
                          onChange={(event) => setEditingCheckpointName(event.target.value)}
                          onBlur={() => commitRenameCheckpoint(checkpoint.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              commitRenameCheckpoint(checkpoint.id)
                            }
                            if (event.key === "Escape") {
                              event.preventDefault()
                              cancelRenameCheckpoint()
                            }
                          }}
                          className="flex-1 px-2 py-1.5 rounded-md border border-[#5b95d7] bg-[#11151c] text-[11px] text-[#d9e2ef] focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => jumpToCheckpoint(checkpoint)}
                          onDoubleClick={() => startRenameCheckpoint(checkpoint)}
                          className="flex-1 text-left px-2 py-1.5 rounded-md text-[11px] text-[#c7d0df] hover:bg-[#263040] hover:text-[#e5edf8] transition-colors"
                          title="双击重命名"
                        >
                          {checkpoint.name}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeCheckpoint(checkpoint.id)}
                        className="shrink-0 p-1 rounded-md text-[#8ea2be] hover:text-[#f0b2b2] hover:bg-[#3a2a30] transition-colors"
                        title="删除检查点"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.14em] text-[#7f8ca0]">可撤销</div>
                <div className="space-y-1">
                  {visibleUndoGroups.length === 0 && (
                    <div className="px-2 py-1.5 text-[10px] text-[#6f7b8f]">暂无可撤销动作</div>
                  )}
                  {visibleUndoGroups.map((group, index) => (
                    <button
                      key={`undo-${index}-${group.label}-${group.count}`}
                      type="button"
                      onClick={() => undoMany(group.steps)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[11px] text-[#c7d0df] hover:bg-[#263040] hover:text-[#e5edf8] transition-colors"
                    >
                      <span className="text-[#8ea2be] mr-1">-{group.steps}</span>
                      {group.label}
                      {group.count > 1 && <span className="ml-1 text-[#8ea2be]">x{group.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.14em] text-[#7f8ca0]">可重做</div>
                <div className="space-y-1">
                  {visibleRedoGroups.length === 0 && (
                    <div className="px-2 py-1.5 text-[10px] text-[#6f7b8f]">暂无可重做动作</div>
                  )}
                  {visibleRedoGroups.map((group, index) => (
                    <button
                      key={`redo-${index}-${group.label}-${group.count}`}
                      type="button"
                      onClick={() => redoMany(group.steps)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[11px] text-[#c7d0df] hover:bg-[#253243] hover:text-[#e5edf8] transition-colors"
                    >
                      <span className="text-[#8ea2be] mr-1">+{group.steps}</span>
                      {group.label}
                      {group.count > 1 && <span className="ml-1 text-[#8ea2be]">x{group.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="h-[calc(100%-2rem)] max-md:h-[calc(100%-4.25rem)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
            }}
            nodeTypes={nodeTypes}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            fitView
            fitViewOptions={{ padding: 0.24, duration: 300 }}
            className="bg-[linear-gradient(160deg,#16181d_0%,#101216_100%)]"
          >
            <Panel position="top-right" className="max-md:hidden rounded-md border border-[#2f3136] bg-[#181a1f]/90 px-2 py-1 text-[10px] text-[#99a0ad] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
              节点更改 220ms 自动保存
            </Panel>
            <Background color="#2f3743" gap={18} size={1.1} />
            <Controls showInteractive={false} className="!bg-[#1c1f24] !border !border-[#2f3136] !text-[#d2d7df]" />
            <MiniMap
              nodeColor={() => "#4f8cc9"}
              style={{ background: "#17191d", border: "1px solid #2f3136" }}
              maskColor="rgba(0, 0, 0, 0.38)"
              className="max-md:hidden"
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}
