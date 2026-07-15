import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import {
  ReactFlow, Background, Controls, MiniMap, Panel, MarkerType,
  applyEdgeChanges, applyNodeChanges,
  useNodesState, useEdgesState, useReactFlow, useNodesInitialized, ReactFlowProvider,
  type Connection, type EdgeChange, type NodeChange, type NodeTypes
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./flow-editor.css"
import type { ActionsSchemaV2 } from "@/types/schema"
import { stringifyKether } from "@/lib/kether-ast"
import type { KetherNode, KetherEdge, KetherInputKind } from "./flow-types"
import { applyConnectionToFlow, flowToAst, inferEditedInputKind, inferInputKind, initializeFlowFromText } from "@/lib/kether-flow"
import { ActionNode } from "./nodes/ActionNode"
import { DataNode } from "./nodes/DataNode"
import { CalcNode } from "./nodes/CalcNode"
import { SetNode } from "./nodes/SetNode"
import { BranchNode } from "./nodes/BranchNode"
import { LoopNode } from "./nodes/LoopNode"
import { RawNode } from "./nodes/RawNode"
import { SchemaProvider } from "./SchemaContext"
import { AlignVerticalSpaceAround, BookmarkPlus, History, Link2, Undo2, Redo2, X } from "lucide-react"
import { NodePalette } from "./NodePalette"
import type { SchemaAction } from "@/types/schema"
import { bindFlowNodeInteractions, semanticFlowSnapshotKey } from "./flow-history"
import { layoutFlowGraph } from "./flow-layout"
import { rebuildGeneratedFlowEdges } from "./flow-edges"
import { createDeferredSemanticWriteback, type DeferredSemanticWriteback } from "@/lib/deferred-semantic-writeback"
import { useEditorInputFlush } from "@/lib/editor-input-flush"
import { ScratchEditor } from "./ScratchEditor"

const nodeTypes: NodeTypes = {
  actionNode: ActionNode,
  dataNode: DataNode,
  calcNode: CalcNode,
  setNode: SetNode,
  branchNode: BranchNode,
  loopNode: LoopNode,
  rawNode: RawNode,
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

interface PendingFlowWriteback extends FlowSnapshot {
  schema: ActionsSchemaV2
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
      onInputChange: undefined,
    },
  }))
}

function cloneSnapshot(nodes: KetherNode[], edges: KetherEdge[]): FlowSnapshot {
  return {
    nodes: normalizeSnapshotNodes(nodes).map((node) => ({ ...node, data: { ...node.data } })),
    edges: edges.map((edge) => ({ ...edge })),
  }
}

function semanticSnapshotKey(snapshot: FlowSnapshot): string {
  return semanticFlowSnapshotKey({
    nodes: snapshot.nodes.map((node) => {
      const nodeWithoutStyle = { ...node }
      const dataWithoutLayout = { ...node.data }
      delete nodeWithoutStyle.style
      delete dataWithoutLayout.layout
      return { ...nodeWithoutStyle, data: dataWithoutLayout } as KetherNode
    }).sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...snapshot.edges].sort((left, right) => left.id.localeCompare(right.id)),
  })
}

function stableDimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
}

function flowLayoutInputSignature(nodes: KetherNode[], edges: KetherEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId ?? null,
      type: node.type,
      width: stableDimension(node.measured?.width ?? node.width),
      height: stableDimension(node.measured?.height ?? node.height),
      slots: Object.entries(node.data.slotChildren ?? {}).map(([slot, ids]) => [slot, ids]),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      kind: edge.data?.kind ?? null,
      semantic: edge.data?.semantic ?? null,
    })),
  })
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
  return <ScratchEditor {...props} />
}

/** 仅保留给旧快照/回归测试；生产入口已切换到 BlockDocument Scratch 编辑器。 */
export function LegacyFlowEditor(props: FlowEditorProps) {
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
  const lastInternalYamlRef = useRef<string | null>(null)
  const nodesRef = useRef<KetherNode[]>([])
  const edgesRef = useRef<KetherEdge[]>([])
  const readOnlyReasonsRef = useRef<string[]>([])
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const writebackRef = useRef<DeferredSemanticWriteback<PendingFlowWriteback> | null>(null)
  const restoringRef = useRef(false)
  const draggingRef = useRef(false)
  const inlineMergeActiveRef = useRef(false)
  const inlineMergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyPastRef = useRef<HistoryEntry[]>([])
  const historyFutureRef = useRef<HistoryEntry[]>([])
  const historyKeyRef = useRef("")
  const manualLockedNodeIdsRef = useRef(new Set<string>())
  const pendingNewNodeIdsRef = useRef(new Set<string>())
  const initialLayoutDoneRef = useRef(false)
  const lastLayoutInputSignatureRef = useRef("")
  const fitViewFrameRef = useRef<number | null>(null)

  valueRef.current = value
  onChangeRef.current = onChange
  if (!writebackRef.current) {
    writebackRef.current = createDeferredSemanticWriteback(220, (snapshot) => {
      if (readOnlyReasonsRef.current.length > 0) return false
      try {
        const ast = flowToAst({ nodes: snapshot.nodes, edges: snapshot.edges }, snapshot.schema)
        const text = stringifyKether(ast)
        if (text !== valueRef.current) {
          lastInternalYamlRef.current = text
          onChangeRef.current(text)
        }
        return true
      } catch {
        return false
      }
    })
  }

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
  const [readOnlyReasons, setReadOnlyReasons] = useState<string[]>([])
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const isReadOnly = readOnlyReasons.length > 0

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
  const nodesInitialized = useNodesInitialized()
  const { screenToFlowPosition, fitView } = useReactFlow<KetherNode, KetherEdge>()

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  const flushSemanticWriteback = useCallback(() => writebackRef.current?.flush() ?? true, [])
  useEditorInputFlush(flushSemanticWriteback)

  const pushToText = useCallback((nextNodes: KetherNode[], nextEdges: KetherEdge[]) => {
    if (readOnlyReasonsRef.current.length > 0) return
    const snapshot = cloneSnapshot(nextNodes, nextEdges)
    historyKeyRef.current = snapshotKey(snapshot)
    writebackRef.current?.schedule({ ...snapshot, schema })
  }, [schema])

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
    const currentSnapshot = cloneSnapshot(nodesRef.current, edgesRef.current)
    const restored = cloneSnapshot(snapshot.nodes, snapshot.edges)
    const nodesValue = restored.nodes
    const edgesValue = restored.edges
    const semanticChanged = semanticSnapshotKey(currentSnapshot) !== semanticSnapshotKey(restored)
    setNodes(nodesValue)
    setEdges(edgesValue)
    nodesRef.current = nodesValue
    edgesRef.current = edgesValue
    if (semanticChanged) pushToText(nodesValue, edgesValue)
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
    if (readOnlyReasonsRef.current.length > 0) return
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

  const handleNodesChange = useCallback((changes: NodeChange<KetherNode>[]) => {
    if (changes.length === 0) return
    const semanticChanges = changes.filter((change) => change.type === "remove" || change.type === "add" || change.type === "replace")
    const applicableChanges = isReadOnly
      ? changes.filter((change) => change.type !== "remove" && change.type !== "add" && change.type !== "replace")
      : changes
    const effectiveSemanticChanges = isReadOnly ? [] : semanticChanges
    if (applicableChanges.length === 0) return

    if (effectiveSemanticChanges.length > 0) {
      rememberBeforeChange(getNodeChangeLabel(effectiveSemanticChanges))
      inlineMergeActiveRef.current = false
    }

    setNodes((current) => {
      const removed = new Set(
        effectiveSemanticChanges
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      )
      let foundDescendant = true
      while (foundDescendant) {
        foundDescendant = false
        for (const node of current) {
          if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
            removed.add(node.id)
            foundDescendant = true
          }
        }
      }

      let next = applyNodeChanges(applicableChanges, current)
      if (removed.size > 0) {
        next = next
          .filter((node) => !removed.has(node.id))
          .map((node) => ({
            ...node,
            data: {
              ...node.data,
              slotChildren: Object.fromEntries(
                Object.entries(node.data.slotChildren ?? {}).map(([slot, ids]) => [
                  slot,
                  ids.filter((id) => !removed.has(id)),
                ]),
              ),
            },
          }))
        for (const id of removed) {
          manualLockedNodeIdsRef.current.delete(id)
          pendingNewNodeIdsRef.current.delete(id)
          positionsRef.current.delete(id)
        }
      }

      let nextEdges = edgesRef.current
      if (effectiveSemanticChanges.length > 0) {
        nextEdges = rebuildGeneratedFlowEdges(
          next,
          edgesRef.current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        )
        edgesRef.current = nextEdges
        setEdges(nextEdges)
        pushToText(next, nextEdges)
      }
      nodesRef.current = next
      return next
    })
  }, [isReadOnly, rememberBeforeChange, setEdges, setNodes, pushToText])

  const handleEdgesChange = useCallback((changes: EdgeChange<KetherEdge>[]) => {
    if (changes.length === 0) return
    const semanticChanges = changes.filter((change) => change.type === "remove" || change.type === "add" || change.type === "replace")
    const applicableChanges = isReadOnly
      ? changes.filter((change) => change.type !== "remove" && change.type !== "add" && change.type !== "replace")
      : changes
    const effectiveSemanticChanges = isReadOnly ? [] : semanticChanges
    if (applicableChanges.length === 0) return
    if (effectiveSemanticChanges.length > 0) {
      rememberBeforeChange(getEdgeChangeLabel(effectiveSemanticChanges))
      inlineMergeActiveRef.current = false
    }
    setEdges((current) => {
      const changedEdges = applyEdgeChanges(applicableChanges, current)
      const next = effectiveSemanticChanges.length > 0
        ? rebuildGeneratedFlowEdges(nodesRef.current, changedEdges)
        : changedEdges
      edgesRef.current = next
      if (effectiveSemanticChanges.length > 0) pushToText(nodesRef.current, next)
      return next
    })
  }, [isReadOnly, rememberBeforeChange, setEdges, pushToText])

  const handleConnect = useCallback((connection: Connection) => {
    if (isReadOnly) return
    const result = applyConnectionToFlow(
      { nodes: nodesRef.current, edges: edgesRef.current },
      connection,
      `${connection.source ?? "src"}-${connection.target ?? "dst"}-${Date.now()}`
    )
    if (!result.accepted) {
      setConnectionError(result.reason)
      return
    }

    rememberBeforeChange(result.kind === "data" ? "连接参数" : "创建执行连线")
    inlineMergeActiveRef.current = false
    setConnectionError(null)
    const nextEdges = rebuildGeneratedFlowEdges(result.state.nodes, result.state.edges)
    nodesRef.current = result.state.nodes
    edgesRef.current = nextEdges
    setNodes(result.state.nodes)
    setEdges(nextEdges)
    pushToText(result.state.nodes, nextEdges)
  }, [isReadOnly, rememberBeforeChange, setEdges, setNodes, pushToText])

  const createActionNode = useCallback((action: SchemaAction, x: number, y: number): KetherNode => {
    const inputs: Record<string, unknown> = {}
    const inputKinds: Record<string, KetherInputKind> = {}
    for (const input of action.inputs) {
      if (!input.required && input.default == null) continue
      const value = input.default ?? ""
      inputs[input.key] = value
      inputKinds[input.key] = inferInputKind(input, value)
    }
    return {
      id: nextNodeId("action"),
      type: "actionNode",
      position: { x, y },
      data: {
        label: action.name,
        schemaAction: action,
        inputs,
        inputKinds,
        slotChildren: {},
        onSlotDrop: undefined,
        nodeKind: "action",
        variantId: action.variantId,
        blockShape: action.shape,
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
          data: { label: "set", schemaAction: null, inputs: { variable: "x", value: "" }, inputKinds: { variable: "identifier", value: "string" }, slotChildren: {}, onSlotDrop: undefined, nodeKind: "set" },
        }
      case "data":
      case "literal":
        return {
          id: nextNodeId("data"),
          type: "dataNode",
          position: { x, y },
          data: {
            label: "数据",
            schemaAction: null,
            inputs: { builtin: "literal", value: "" },
            inputKinds: { builtin: "identifier", value: "string" },
            slotChildren: {},
            onSlotDrop: undefined,
            nodeKind: "data",
            provides: { output: "string" },
          },
        }
      case "if":
        return {
          id: nextNodeId("branch"),
          type: "branchNode",
          position: { x, y },
          data: {
            label: builtin,
            schemaAction: null,
            inputs: { condition: "true" },
            inputKinds: { condition: "boolean" },
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
            inputKinds: { variable: "identifier", iterable: "var_ref" },
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
          data: { label: "calc", schemaAction: null, inputs: { formula: "" }, inputKinds: { formula: "string" }, slotChildren: {}, onSlotDrop: undefined, nodeKind: "calc", blockShape: "reporter" },
        }
      case "raw":
        return {
          id: nextNodeId("raw"),
          type: "rawNode",
          position: { x, y },
          data: { label: "Raw Kether", schemaAction: null, inputs: { source: "" }, inputKinds: { source: "raw" }, slotChildren: {}, onSlotDrop: undefined, nodeKind: "raw", blockShape: "raw", rawSource: "" },
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
    if (readOnlyReasonsRef.current.length > 0) return
    rememberBeforeChange("插入子节点")
    inlineMergeActiveRef.current = false
    setNodes((current) => {
      const parent = current.find((node) => node.id === parentId)
      if (!parent) return current

      const parentData = parent.data
      const existing = parentData.slotChildren[slot] ?? []
      const nextNode = createNodeFromPayload(payload, 24, 96 + existing.length * 86)
      if (!nextNode) return current

      // 不设置 extent="parent"：父容器尺寸由下一轮递归布局计算，提前约束会把子节点夹到旧边界。
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
      const nextEdges = rebuildGeneratedFlowEdges(nextNodes, edgesRef.current)
      pendingNewNodeIdsRef.current.add(childNode.id)
      nodesRef.current = nextNodes
      edgesRef.current = nextEdges
      setEdges(nextEdges)
      pushToText(nextNodes, nextEdges)
      return nextNodes
    })
  }, [createNodeFromPayload, rememberBeforeChange, setEdges, setNodes, pushToText])

  const handleNodeInputChange = useCallback((nodeId: string, key: string, value: unknown, kind?: KetherInputKind) => {
    if (readOnlyReasonsRef.current.length > 0) return
    notifyInlineEdit()
    setNodes((current) => {
      const next = current.map((node) => {
        if (node.id !== nodeId) return node
        const nextKind = kind ?? inferEditedInputKind(node.data.inputKinds[key], value)
        const inputKinds = { ...node.data.inputKinds, [key]: nextKind }
        const inputs = { ...node.data.inputs, [key]: value }
        const label = node.data.nodeKind === "data"
          ? String(value ?? "")
          : node.data.nodeKind === "set" && key === "variable"
            ? `set ${String(value ?? "")}`
            : node.data.nodeKind === "loop" && key === "variable"
              ? `for ${String(value ?? "")}`
              : node.data.label
        const provides = node.data.nodeKind === "loop" && key === "variable"
          ? { [String(value ?? "")]: String(value ?? "") }
          : node.data.provides
        return { ...node, data: { ...node.data, inputs, inputKinds, label, provides } }
      })
      nodesRef.current = next
      pushToText(next, edgesRef.current)
      return next
    })
  }, [notifyInlineEdit, setNodes, pushToText])

  const interactiveNodes = useMemo(
    () => bindFlowNodeInteractions(nodes, handleSlotDrop, handleNodeInputChange),
    [nodes, handleSlotDrop, handleNodeInputChange]
  )

  const visualEdges = useMemo(() => edges.filter((edge) => (
    edge.data?.kind === "structure" || (edge.data?.kind === "execution" && edge.data.generated !== true)
  )).map((edge) => {
    const kind = edge.data?.kind ?? (edge.targetHandle && edge.sourceHandle !== "flow-out" ? "data" : "execution")
    const color = kind === "data" ? "#22d3ee" : kind === "structure" ? "#b74732" : "#f59e0b"
    return {
      ...edge,
      type: "smoothstep",
      animated: false,
      deletable: edge.data?.generated !== true,
      style: {
        ...edge.style,
        stroke: color,
        strokeWidth: kind === "execution" ? 2 : 1.7,
        strokeDasharray: kind === "structure" ? "7 5" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: kind === "execution" ? 18 : 16,
        height: kind === "execution" ? 18 : 16,
      },
    } as KetherEdge
  }), [edges])

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    if (readOnlyReasonsRef.current.length > 0) return
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
        const nextEdges = rebuildGeneratedFlowEdges(next, edgesRef.current)
        manualLockedNodeIdsRef.current.add(nextNode.id)
        positionsRef.current.set(nextNode.id, { ...nextNode.position })
        nodesRef.current = next
        edgesRef.current = nextEdges
        setEdges(nextEdges)
        pushToText(next, nextEdges)
        return next
      })
    } catch {
      return
    }
  }, [createActionNode, createBuiltinNode, rememberBeforeChange, screenToFlowPosition, setEdges, setNodes, pushToText])

  // 初始化和更新节点图
  useEffect(() => {
    if (lastInternalYamlRef.current && value === lastInternalYamlRef.current) {
      lastInternalYamlRef.current = null
      return
    }
    if (writebackRef.current?.hasPending()) {
      if (!flushSemanticWriteback()) return
      // flush 已同步提交当前节点语义；等待父级 value 回传后再解析，避免用旧 value 覆盖节点。
      return
    }
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current)
    parseTimerRef.current = setTimeout(() => {
      try {
        const flow = initializeFlowFromText(value, schema, positionsRef.current)
        const reasons = flow.readOnlyReasons ?? []
        inlineMergeActiveRef.current = false
        readOnlyReasonsRef.current = reasons
        setReadOnlyReasons(reasons)
        setConnectionError(null)
        lastLayoutInputSignatureRef.current = ""
        pendingNewNodeIdsRef.current.clear()
        manualLockedNodeIdsRef.current = new Set(
          [...manualLockedNodeIdsRef.current].filter((id) => flow.nodes.some((node) => node.id === id))
        )
        initialLayoutDoneRef.current = flow.nodes.length === 0 || manualLockedNodeIdsRef.current.size > 0
        setNodes(flow.nodes)
        setEdges(flow.edges)
        nodesRef.current = flow.nodes
        edgesRef.current = flow.edges
        resetHistory(flow.nodes, flow.edges)
      } catch { /* 解析失败时保持当前状态 */ }
    }, 0) // 使用0ms超时确保在渲染后执行
    return () => { if (parseTimerRef.current) clearTimeout(parseTimerRef.current) }
  }, [value, schema, setNodes, setEdges, resetHistory, flushSemanticWriteback])

  const layoutInputSignature = useMemo(
    () => flowLayoutInputSignature(nodes, edges),
    [nodes, edges]
  )

  const scheduleFitView = useCallback(() => {
    if (fitViewFrameRef.current !== null) cancelAnimationFrame(fitViewFrameRef.current)
    fitViewFrameRef.current = requestAnimationFrame(() => {
      fitViewFrameRef.current = requestAnimationFrame(() => {
        fitViewFrameRef.current = null
        void fitView({ padding: 0.24, duration: 300 })
      })
    })
  }, [fitView])

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return
    if (layoutInputSignature === lastLayoutInputSignatureRef.current) return

    const mode = initialLayoutDoneRef.current ? "preserve" : "force"
    lastLayoutInputSignatureRef.current = layoutInputSignature
    const currentNodes = nodesRef.current
    const result = layoutFlowGraph(currentNodes, edgesRef.current, {
      mode,
      lockedNodeIds: manualLockedNodeIdsRef.current,
      newNodeIds: mode === "preserve" ? pendingNewNodeIdsRef.current : undefined,
    })
    initialLayoutDoneRef.current = true
    pendingNewNodeIdsRef.current.clear()

    const orderChanged = result.nodes.some((node, index) => node.id !== currentNodes[index]?.id)
    if (result.changedNodeIds.length > 0 || orderChanged) {
      nodesRef.current = result.nodes
      setNodes(result.nodes)
    }
    if (mode === "force") scheduleFitView()
  }, [layoutInputSignature, nodes.length, nodesInitialized, scheduleFitView, setNodes])

  const handleAutoLayout = useCallback(() => {
    const currentNodes = nodesRef.current
    if (currentNodes.length === 0) return

    manualLockedNodeIdsRef.current.clear()
    pendingNewNodeIdsRef.current.clear()
    positionsRef.current.clear()
    const result = layoutFlowGraph(currentNodes, edgesRef.current, { mode: "force" })
    const orderChanged = result.nodes.some((node, index) => node.id !== currentNodes[index]?.id)
    const changed = result.changedNodeIds.length > 0 || orderChanged
    if (changed && readOnlyReasonsRef.current.length === 0) rememberBeforeChange("自动布局")

    initialLayoutDoneRef.current = true
    lastLayoutInputSignatureRef.current = flowLayoutInputSignature(result.nodes, edgesRef.current)
    if (changed) {
      nodesRef.current = result.nodes
      setNodes(result.nodes)
    }
    scheduleFitView()
  }, [rememberBeforeChange, scheduleFitView, setNodes])

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
      // 卸载前同步提交有效的语义快照；dispose 不会因清理定时器而丢弃 pending。
      writebackRef.current?.dispose()
      if (inlineMergeTimerRef.current) clearTimeout(inlineMergeTimerRef.current)
      if (fitViewFrameRef.current !== null) cancelAnimationFrame(fitViewFrameRef.current)
    }
  }, [])

  // 拖动节点时保存位置（仅用于布局记忆，不回写文本）
  const onNodeDragStop = (_: unknown, node: KetherNode) => {
    draggingRef.current = false
    inlineMergeActiveRef.current = false
    manualLockedNodeIdsRef.current.add(node.id)
    positionsRef.current.set(node.id, { ...node.position })
  }

  const onNodeDragStart = () => {
    if (isReadOnly || draggingRef.current) return
    draggingRef.current = true
    rememberBeforeChange("移动节点")
  }

  return (
    <div ref={flowRootRef} className="kether-editor flex h-full max-md:flex-col">
      <NodePalette schema={schema} onDragStart={() => {}} />
      <div className="flex-1 min-w-0 relative">
        <div className="kether-flow-toolbar h-11 px-4 flex items-center justify-between gap-3 text-[13px]">
          <div className="flex shrink-0 items-center gap-2 text-[#a6adbb] max-lg:hidden">
            <AlignVerticalSpaceAround className="w-4 h-4 text-[#56b6c2]" />
            {isReadOnly ? "当前脚本仅提供只读节点预览" : "拖拽左侧节点到画布，显式编辑后同步到脚本文本"}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto whitespace-nowrap text-[#7f8795]">
            <button
              type="button"
              onClick={handleAutoLayout}
              disabled={nodes.length === 0}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#2f3136] px-3 py-1 text-[12px] text-[#aab2c0] enabled:hover:bg-[#242933] enabled:hover:text-[#dde4f0] disabled:opacity-45 disabled:cursor-not-allowed"
              title="清除手工位置并自动排列"
            >
              <AlignVerticalSpaceAround className="w-3.5 h-3.5" />
              自动排列
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-[12px] transition-colors ${showHistory ? "border-[#5b95d7] text-[#dce8f8] bg-[#253244]" : "border-[#2f3136] text-[#aab2c0] hover:bg-[#242933] hover:text-[#dde4f0]"}`}
              title="历史时间线"
            >
              <History className="w-3.5 h-3.5" />
              历史
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#2f3136] px-3 py-1 text-[12px] text-[#aab2c0] enabled:hover:bg-[#242933] enabled:hover:text-[#dde4f0] disabled:opacity-45 disabled:cursor-not-allowed"
              title={undoLabel ? `撤销 ${undoLabel} (Ctrl+Z)` : "撤销 (Ctrl+Z)"}
            >
              <Undo2 className="w-3.5 h-3.5" />
              撤销
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#2f3136] px-3 py-1 text-[12px] text-[#aab2c0] enabled:hover:bg-[#242933] enabled:hover:text-[#dde4f0] disabled:opacity-45 disabled:cursor-not-allowed"
              title={redoLabel ? `重做 ${redoLabel} (Ctrl+Y / Ctrl+Shift+Z)` : "重做 (Ctrl+Y / Ctrl+Shift+Z)"}
            >
              <Redo2 className="w-3.5 h-3.5" />
              重做
            </button>
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span className="shrink-0">{isReadOnly ? "已禁用回写" : "已启用显式连接与回写"}</span>
          </div>
        </div>
        {isReadOnly && (
          <div
            className="absolute z-20 top-14 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-amber-500/50 bg-amber-950/90 px-3 py-2 text-[13px] text-amber-100 shadow-lg md:max-w-[680px]"
            title={`节点回写已禁用：${readOnlyReasons.join("；")}`}
          >
            <span className="truncate">节点回写已禁用：{readOnlyReasons[0]}</span>
            {readOnlyReasons.length > 1 && (
              <span className="shrink-0 rounded bg-amber-800/60 px-1.5 py-0.5 text-[12px]">
                另有 {readOnlyReasons.length - 1} 项
              </span>
            )}
          </div>
        )}
        {!isReadOnly && connectionError && (
          <div className="absolute z-20 top-14 left-1/2 -translate-x-1/2 rounded-md border border-red-500/50 bg-red-950/90 px-3 py-2 text-[13px] text-red-100 shadow-lg">
            连线已拒绝：{connectionError}
          </div>
        )}
        {showHistory && (
          <div className="absolute z-20 top-14 right-4 w-72 rounded-lg border border-[#2f3136] bg-[#191411] shadow-[0_12px_24px_rgba(0,0,0,0.45)]">
            <input
              ref={checkpointImportRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={onImportCheckpoints}
            />
            <div className="px-3 py-2 border-b border-[#2f3136] text-[13px] font-medium text-[#d8dee9]">历史时间线</div>
            <div className="px-2 py-2 border-b border-[#2f3136]">
              <button
                type="button"
                onClick={createCheckpoint}
                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md border border-[#2f3136] text-[13px] text-[#cfe0f8] bg-[#253244] hover:bg-[#2b3a51] transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                保存检查点
              </button>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={exportCheckpoints}
                  disabled={checkpoints.length === 0}
                  className="px-2 py-1 rounded-md border border-[#2f3136] text-[12px] text-[#b8c8df] enabled:hover:bg-[#222d3b] enabled:hover:text-[#e5edf8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  导出
                </button>
                <button
                  type="button"
                  onClick={openImportCheckpoints}
                  className="px-2 py-1 rounded-md border border-[#2f3136] text-[12px] text-[#b8c8df] hover:bg-[#222d3b] hover:text-[#e5edf8] transition-colors"
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
                className="w-full px-2 py-1 rounded-md border border-[#2f3136] bg-[#11151c] text-[13px] text-[#d9e2ef] placeholder:text-[#6e7c92] focus:outline-none focus:ring-1 focus:ring-[#5b95d7]"
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
                  className={`px-2 py-1 rounded-md text-[12px] border transition-colors ${historyFilter === value ? "border-[#5b95d7] text-[#dce8f8] bg-[#253244]" : "border-[#2f3136] text-[#8ea2be] hover:text-[#dbe8f8] hover:bg-[#222d3b]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-2">
              <div>
                <div className="px-1 pb-1 text-[12px] uppercase tracking-[0.14em] text-[#7f8ca0]">检查点</div>
                <div className="space-y-1">
                  {checkpoints.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] text-[#6f7b8f]">暂无检查点</div>
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
                          className="flex-1 px-2 py-1.5 rounded-md border border-[#5b95d7] bg-[#11151c] text-[13px] text-[#d9e2ef] focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => jumpToCheckpoint(checkpoint)}
                          onDoubleClick={() => startRenameCheckpoint(checkpoint)}
                          className="flex-1 text-left px-2 py-1.5 rounded-md text-[13px] text-[#c7d0df] hover:bg-[#263040] hover:text-[#e5edf8] transition-colors"
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
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="px-1 pb-1 text-[12px] uppercase tracking-[0.14em] text-[#7f8ca0]">可撤销</div>
                <div className="space-y-1">
                  {visibleUndoGroups.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] text-[#6f7b8f]">暂无可撤销动作</div>
                  )}
                  {visibleUndoGroups.map((group, index) => (
                    <button
                      key={`undo-${index}-${group.label}-${group.count}`}
                      type="button"
                      onClick={() => undoMany(group.steps)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[13px] text-[#c7d0df] hover:bg-[#263040] hover:text-[#e5edf8] transition-colors"
                    >
                      <span className="text-[#8ea2be] mr-1">-{group.steps}</span>
                      {group.label}
                      {group.count > 1 && <span className="ml-1 text-[#8ea2be]">x{group.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="px-1 pb-1 text-[12px] uppercase tracking-[0.14em] text-[#7f8ca0]">可重做</div>
                <div className="space-y-1">
                  {visibleRedoGroups.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] text-[#6f7b8f]">暂无可重做动作</div>
                  )}
                  {visibleRedoGroups.map((group, index) => (
                    <button
                      key={`redo-${index}-${group.label}-${group.count}`}
                      type="button"
                      onClick={() => redoMany(group.steps)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[13px] text-[#c7d0df] hover:bg-[#253243] hover:text-[#e5edf8] transition-colors"
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
        <div className="h-[calc(100%-2.75rem)] max-md:h-[calc(100%-5rem)]">
          <ReactFlow
            nodes={interactiveNodes}
            edges={visualEdges}
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
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            deleteKeyCode={isReadOnly ? null : ["Backspace", "Delete"]}
            elementsSelectable
            fitViewOptions={{ padding: 0.24, duration: 300 }}
            className="bg-[#101216]"
          >
            <Panel position="top-right" className="max-md:hidden rounded-md border border-[#2f3136] bg-[#181a1f]/90 px-3 py-1.5 text-[12px] text-[#99a0ad] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
              {isReadOnly ? "复杂脚本：只读预览" : "仅显式语义修改 220ms 保存"}
            </Panel>
            <Background color="#2f3743" gap={22} size={1.2} />
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
