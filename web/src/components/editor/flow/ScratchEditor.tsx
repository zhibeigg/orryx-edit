import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Layers3, Trash2 } from "lucide-react"
import {
  buildSchemaCatalog,
  keywordAlternatives,
  type ActionsSchemaV2,
  type SchemaAction,
  type SchemaInput,
  type UnifiedActionsSchema,
} from "@/types/schema"
import {
  canDockBlock,
  parseBlockDocument,
  serializeBlockDocument,
  type BlockDocument,
  type BlockInput,
  type DocumentBlock,
} from "@/lib/block-document"
import { EnumCombobox } from "./EnumCombobox"
import { resolveEnumOptions } from "./enum-input"
import { NodePalette } from "./NodePalette"
import { getKetherBuiltinColor, getKetherCategoryColor } from "./category-presentation"
import "./flow-editor.css"

const BLOCK_MIME = "application/kether-block-ref"
const PALETTE_MIME = "application/kether-node"

type BlockParent = DocumentBlock["parent"]
type PalettePayload = SchemaAction | { builtin: string }

interface ScratchEditorProps {
  value: string
  onChange: (value: string) => void
  schema: ActionsSchemaV2
}

function cloneDocument(document: BlockDocument): BlockDocument {
  return {
    ...document,
    roots: [...document.roots],
    blocks: Object.fromEntries(Object.entries(document.blocks).map(([id, block]) => [id, {
      ...block,
      inputs: { ...block.inputs },
      branches: Object.fromEntries(Object.entries(block.branches).map(([slot, ids]) => [slot, [...ids]])),
      parent: block.parent ? { ...block.parent } : null,
    }])),
  }
}

function sequence(document: BlockDocument, parent: BlockParent): string[] {
  if (!parent) return document.roots
  return document.blocks[parent.blockId]?.branches[parent.slot] ?? []
}

function replaceSequence(document: BlockDocument, parent: BlockParent, ids: string[]) {
  ids.forEach((id, order) => {
    const block = document.blocks[id]
    if (block) {
      block.order = order
      block.parent = parent ? { ...parent } : null
    }
  })
  if (!parent) document.roots = ids
  else if (document.blocks[parent.blockId]) document.blocks[parent.blockId].branches[parent.slot] = ids
}

function detachBlock(document: BlockDocument, blockId: string) {
  document.roots = document.roots.filter((id) => id !== blockId)
  for (const block of Object.values(document.blocks)) {
    for (const [slot, ids] of Object.entries(block.branches)) block.branches[slot] = ids.filter((id) => id !== blockId)
    for (const [key, input] of Object.entries(block.inputs)) {
      if (input.kind === "block" && input.blockId === blockId) delete block.inputs[key]
    }
  }
  if (document.blocks[blockId]) document.blocks[blockId].parent = null
}

function descendants(document: BlockDocument, blockId: string, result = new Set<string>()): Set<string> {
  if (result.has(blockId)) return result
  result.add(blockId)
  const block = document.blocks[blockId]
  if (!block) return result
  for (const input of Object.values(block.inputs)) if (input.kind === "block") descendants(document, input.blockId, result)
  for (const ids of Object.values(block.branches)) for (const id of ids) descendants(document, id, result)
  return result
}

function serializationFor(schema: UnifiedActionsSchema, type: string): Extract<BlockInput, { kind: "literal" }>["serialization"] {
  return schema.types[type]?.serialization ?? "raw"
}

function defaultInput(schema: UnifiedActionsSchema, input: SchemaInput): BlockInput | undefined {
  if (!input.required && input.default == null && keywordAlternatives(input).length === 0) return undefined
  const type = schema.types[input.type]
  const value = input.default ?? (input.type === "boolean" ? false : keywordAlternatives(input)[0] ?? "")
  if (type && !type.ketherFillable && type.inputStrategy === "raw") return { kind: "raw", type: input.type, source: String(value ?? "") }
  return { kind: "literal", type: input.type, value, serialization: serializationFor(schema, input.type) }
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createBlock(payload: PalettePayload, schema: UnifiedActionsSchema): DocumentBlock | null {
  if ("builtin" in payload && typeof payload.builtin === "string") {
    const id = nextId(payload.builtin)
    const base = { id, source: undefined, order: 0, parent: null } as const
    switch (payload.builtin) {
      case "set": return { ...base, kind: "command", opcode: "set", outputType: "unit", inputs: {
        variable: { kind: "literal", type: "text", value: "value", serialization: "token" },
        value: { kind: "literal", type: "any", value: "", serialization: "raw" },
      }, branches: {} }
      case "if": return { ...base, kind: "container", opcode: "if", outputType: "unit", inputs: {
        condition: { kind: "literal", type: "predicate", value: true, serialization: "token" },
      }, branches: { then: [], else: [] } }
      case "for": return { ...base, kind: "container", opcode: "for", outputType: "unit", inputs: {
        variable: { kind: "literal", type: "text", value: "item", serialization: "token" },
        iterable: { kind: "raw", type: "reporter", source: "&items" },
      }, branches: { body: [] } }
      case "case": return { ...base, kind: "container", opcode: "case", outputType: "any", inputs: {
        value: { kind: "literal", type: "any", value: "", serialization: "raw" },
        "when:0": { kind: "literal", type: "any", value: "", serialization: "raw" },
      }, branches: { "when:0": [], else: [] } }
      case "check": return { ...base, kind: "predicate", opcode: "check", outputType: "boolean", inputs: {
        left: { kind: "literal", type: "any", value: "", serialization: "raw" },
        operator: { kind: "literal", type: "keyword", value: "==", serialization: "token" },
        right: { kind: "literal", type: "any", value: "", serialization: "raw" },
      }, branches: {} }
      case "any":
      case "all": return { ...base, kind: "predicate", opcode: payload.builtin, outputType: "boolean", inputs: {
        "condition:0": { kind: "literal", type: "predicate", value: true, serialization: "token" },
        "condition:1": { kind: "literal", type: "predicate", value: true, serialization: "token" },
      }, branches: {} }
      case "math": return { ...base, kind: "reporter", opcode: "math", outputType: "number", inputs: {
        operator: { kind: "literal", type: "keyword", value: "+", serialization: "token" },
        "operand:0": { kind: "literal", type: "number", value: 0, serialization: "token" },
        "operand:1": { kind: "literal", type: "number", value: 0, serialization: "token" },
      }, branches: {} }
      case "calc": return { ...base, kind: "reporter", opcode: "calc", outputType: "number", inputs: {
        formula: { kind: "literal", type: "text", value: "", serialization: "quoted" },
      }, branches: {} }
      case "sync":
      case "async": return { ...base, kind: "container", opcode: payload.builtin, outputType: "unit", inputs: {}, branches: { body: [] } }
      case "raw": return { ...base, kind: "raw", opcode: "raw", outputType: "raw", inputs: {
        source: { kind: "raw", type: "raw", source: "" },
      }, branches: {} }
      default: return null
    }
  }
  const inputs: Record<string, BlockInput> = {}
  for (const input of payload.inputs) {
    const value = defaultInput(schema, input)
    if (value) inputs[input.key] = value
  }
  return {
    id: nextId(payload.shape),
    kind: payload.shape,
    opcode: payload.name,
    actionId: payload.id,
    variantId: payload.variantId,
    outputType: payload.output?.type ?? "unit",
    inputs,
    branches: Object.fromEntries((payload.slots ?? []).map((slot) => [slot.name, []])),
    order: 0,
    parent: null,
  }
}

function builtinInputs(block: DocumentBlock): SchemaInput[] {
  const input = (key: string, name: string, type: string, accepts = [type], options?: string[]): SchemaInput => ({ name, key, type, accepts, required: true, default: null, options })
  switch (block.opcode) {
    case "set": return [input("variable", "变量", "text"), input("value", "值", "any")]
    case "if": return [input("condition", "条件", "predicate", ["predicate", "boolean"])]
    case "for": return [input("variable", "迭代变量", "text"), input("iterable", "集合", "reporter", ["reporter", "list", "collection", "any"])]
    case "case": return [input("value", "分派值", "any"), ...Object.keys(block.inputs).filter((key) => key.startsWith("when:")).sort().map((key, index) => input(key, `匹配 ${index + 1}`, "any"))]
    case "check": return [input("left", "左值", "any"), input("operator", "比较", "keyword", ["keyword"], ["==", "!=", ">", ">=", "<", "<=", "in"]), input("right", "右值", "any")]
    case "any":
    case "all": return Object.keys(block.inputs).filter((key) => key.startsWith("condition:")).sort().map((key, index) => input(key, `条件 ${index + 1}`, "predicate", ["predicate", "boolean"]))
    case "math": return [input("operator", "运算", "keyword", ["keyword"], ["+", "-", "*", "/", "%", "pow", "min", "max"]), ...Object.keys(block.inputs).filter((key) => key.startsWith("operand:")).sort().map((key, index) => input(key, `数值 ${index + 1}`, "number"))]
    case "calc": return [input("formula", "公式", "text")]
    default: return []
  }
}

export function ScratchEditor({ value, onChange, schema: schemaInput }: ScratchEditorProps) {
  const schema = useMemo(() => buildSchemaCatalog(schemaInput).schema, [schemaInput])
  const catalog = useMemo(() => buildSchemaCatalog(schema), [schema])
  const [document, setDocument] = useState(() => parseBlockDocument(value, schema))
  const [dropError, setDropError] = useState<string | null>(null)
  const emitted = useRef<string | null>(null)

  useEffect(() => {
    if (emitted.current === value) {
      emitted.current = null
      return
    }
    const timer = window.setTimeout(() => setDocument(parseBlockDocument(value, schema)), 0)
    return () => window.clearTimeout(timer)
  }, [value, schema])

  const commit = useCallback((mutate: (draft: BlockDocument) => void) => {
    setDocument((current) => {
      const next = cloneDocument(current)
      mutate(next)
      const text = serializeBlockDocument(next, schema)
      emitted.current = text
      onChange(text)
      return next
    })
  }, [onChange, schema])

  const insertPayload = useCallback((payload: PalettePayload, parent: BlockParent, index: number) => {
    const block = createBlock(payload, schema)
    if (!block) return
    commit((draft) => {
      draft.blocks[block.id] = block
      const ids = [...sequence(draft, parent)]
      ids.splice(index, 0, block.id)
      replaceSequence(draft, parent, ids)
    })
  }, [commit, schema])

  const moveBlock = useCallback((blockId: string, parent: BlockParent, index: number) => {
    commit((draft) => {
      if (!draft.blocks[blockId]) return
      if (parent && descendants(draft, blockId).has(parent.blockId)) return
      detachBlock(draft, blockId)
      const ids = [...sequence(draft, parent)].filter((id) => id !== blockId)
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, blockId)
      replaceSequence(draft, parent, ids)
    })
  }, [commit])

  const deleteBlock = useCallback((blockId: string) => {
    commit((draft) => {
      const removed = descendants(draft, blockId)
      for (const id of removed) detachBlock(draft, id)
      for (const id of removed) delete draft.blocks[id]
    })
  }, [commit])

  const updateInput = useCallback((blockId: string, input: SchemaInput, value: unknown, raw = false) => {
    commit((draft) => {
      const block = draft.blocks[blockId]
      if (!block) return
      block.inputs[input.key] = raw
        ? { kind: "raw", type: input.type, source: String(value ?? "") }
        : { kind: "literal", type: input.type, value, serialization: serializationFor(schema, input.type) }
    })
  }, [commit, schema])

  const attachInputBlock = useCallback((targetId: string, input: SchemaInput, sourceId: string) => {
    const source = document.blocks[sourceId]
    if (!source) return
    if (descendants(document, sourceId).has(targetId)) {
      setDropError("不能把父块嵌入自己的子槽")
      return
    }
    const result = canDockBlock(schema, source, input)
    if (!result.accepted) {
      setDropError(result.reason ?? "类型不兼容")
      return
    }
    setDropError(null)
    commit((draft) => {
      const target = draft.blocks[targetId]
      if (!target) return
      const previous = target.inputs[input.key]
      if (previous?.kind === "block") {
        detachBlock(draft, previous.blockId)
        const roots = [...draft.roots, previous.blockId]
        replaceSequence(draft, null, roots)
      }
      detachBlock(draft, sourceId)
      target.inputs[input.key] = { kind: "block", blockId: sourceId }
      draft.blocks[sourceId].parent = { blockId: targetId, slot: input.key }
    })
  }, [commit, document, schema])

  const moveSibling = useCallback((blockId: string, direction: -1 | 1) => {
    const block = document.blocks[blockId]
    if (!block) return
    const ids = sequence(document, block.parent)
    const index = ids.indexOf(blockId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    const reordered = [...ids]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    commit((draft) => replaceSequence(draft, block.parent, reordered))
  }, [commit, document])

  const parseDrop = (event: DragEvent): { blockId?: string; payload?: PalettePayload } | null => {
    const blockId = event.dataTransfer.getData(BLOCK_MIME)
    if (blockId) return { blockId }
    const raw = event.dataTransfer.getData(PALETTE_MIME)
    if (!raw) return null
    try { return { payload: JSON.parse(raw) as PalettePayload } } catch { return null }
  }

  const dropIntoSequence = useCallback((event: DragEvent, parent: BlockParent, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const parsed = parseDrop(event)
    if (parsed?.blockId) moveBlock(parsed.blockId, parent, index)
    else if (parsed?.payload) insertPayload(parsed.payload, parent, index)
  }, [insertPayload, moveBlock])

  const renderStack = (parent: BlockParent, ids: string[]) => (
    <div className="scratch-stack" data-empty={ids.length === 0}>
      {ids.map((id, index) => (
        <div key={id}>
          <DropLine onDrop={(event) => dropIntoSequence(event, parent, index)} />
          <BlockView
            blockId={id}
            document={document}
            schema={schema}
            catalog={catalog}
            onDelete={deleteBlock}
            onMove={moveSibling}
            onInput={updateInput}
            onAttach={attachInputBlock}
            renderStack={renderStack}
          />
        </div>
      ))}
      <DropLine empty={ids.length === 0} onDrop={(event) => dropIntoSequence(event, parent, ids.length)} />
    </div>
  )

  return (
    <div className="kether-editor scratch-editor flex h-full max-md:flex-col">
      <NodePalette schema={schema} onDragStart={() => undefined} />
      <section className="scratch-workspace min-w-0 flex-1" aria-label="Kether 拼图工作区">
        <header className="scratch-toolbar">
          <div className="flex items-center gap-2"><Layers3 className="h-4 w-4" /><strong>BlockDocument</strong></div>
          <div className="scratch-toolbar__stats">{document.roots.length} 个根块 · {Object.keys(document.blocks).length} 个语义块 · Registry v{schema.schemaVersion ?? 3}</div>
        </header>
        {dropError && <div className="scratch-error"><AlertTriangle className="h-4 w-4" />{dropError}</div>}
        <div className="scratch-canvas">{renderStack(null, document.roots)}</div>
      </section>
    </div>
  )
}

function DropLine({ onDrop, empty = false }: { onDrop: (event: DragEvent) => void; empty?: boolean }) {
  return <div className="scratch-drop-line" data-empty={empty} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move" }} onDrop={onDrop}>{empty ? "拖入第一块" : "插入此处"}</div>
}

function BlockView({ blockId, document, schema, catalog, onDelete, onMove, onInput, onAttach, renderStack }: {
  blockId: string
  document: BlockDocument
  schema: UnifiedActionsSchema
  catalog: ReturnType<typeof buildSchemaCatalog>
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onInput: (id: string, input: SchemaInput, value: unknown, raw?: boolean) => void
  onAttach: (id: string, input: SchemaInput, sourceId: string) => void
  renderStack: (parent: BlockParent, ids: string[]) => React.ReactNode
}) {
  const block = document.blocks[blockId]
  if (!block) return null
  const action = block.actionId ? catalog.byId.get(block.actionId) ?? catalog.byVariantId.get(block.variantId ?? "") : undefined
  const inputs = action?.inputs ?? builtinInputs(block)
  const fieldInputs = inputs.filter((input) => block.inputs[input.key]?.kind !== "block")
  const nestedInputs = inputs.filter((input) => block.inputs[input.key]?.kind === "block")
  const slots = action?.slots?.map((slot) => ({ name: slot.name, label: slot.label }))
    ?? Object.keys(block.branches).map((name) => ({ name, label: name === "then" ? "条件为真" : name === "else" ? "否则" : name === "body" ? "执行体" : name.startsWith("when:") ? `分支 ${Number(name.split(":")[1]) + 1}` : name }))
  const categoryColor = action ? getKetherCategoryColor(action.category) : getKetherBuiltinColor(block.opcode)
  const renderInput = (input: SchemaInput) => (
    <InputSlot key={input.key} block={block} input={input} document={document} schema={schema} catalog={catalog} onInput={onInput} onAttach={onAttach} onDelete={onDelete} onMove={onMove} renderStack={renderStack} />
  )
  return (
    <div className="scratch-block-tree" style={{ "--block-accent": categoryColor } as React.CSSProperties}>
      <article className="scratch-block" data-shape={block.kind}>
        <header className="scratch-block__header" draggable onDragStart={(event) => { event.dataTransfer.setData(BLOCK_MIME, blockId); event.dataTransfer.effectAllowed = "move" }}>
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
          <strong>{block.opcode}</strong>
          {action && <span className="scratch-block__variant">{action.syntax.split(/\s+/).slice(1, 3).join(" ") || action.variantId}</span>}
          <div className="scratch-block__actions">
            <button type="button" onClick={() => onMove(blockId, -1)} aria-label="上移块"><ChevronUp /></button>
            <button type="button" onClick={() => onMove(blockId, 1)} aria-label="下移块"><ChevronDown /></button>
            <button type="button" onClick={() => onDelete(blockId)} aria-label="删除块"><Trash2 /></button>
          </div>
        </header>
        {block.kind === "raw" ? (
          <textarea className="scratch-raw" rows={3} value={block.inputs.source?.kind === "raw" ? block.inputs.source.source : block.source ?? ""} onChange={(event) => onInput(blockId, { name: "原文", key: "source", type: "raw", accepts: ["raw"], required: true, default: null }, event.target.value, true)} />
        ) : fieldInputs.length > 0 ? (
          <div className="scratch-block__inputs">
            {fieldInputs.map(renderInput)}
          </div>
        ) : null}
        {slots.map((slot) => (
          <section className="scratch-c-slot" key={slot.name}>
            <div className="scratch-c-slot__label">{slot.label}</div>
            {renderStack({ blockId, slot: slot.name }, block.branches[slot.name] ?? [])}
          </section>
        ))}
      </article>
      {nestedInputs.length > 0 && (
        <div className="scratch-block-tree__children">
          {nestedInputs.map(renderInput)}
        </div>
      )}
    </div>
  )
}

function InputSlot({ block, input, document, schema, catalog, onInput, onAttach, onDelete, onMove, renderStack }: {
  block: DocumentBlock
  input: SchemaInput
  document: BlockDocument
  schema: UnifiedActionsSchema
  catalog: ReturnType<typeof buildSchemaCatalog>
  onInput: (id: string, input: SchemaInput, value: unknown, raw?: boolean) => void
  onAttach: (id: string, input: SchemaInput, sourceId: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  renderStack: (parent: BlockParent, ids: string[]) => React.ReactNode
}) {
  const value = block.inputs[input.key]
  const type = schema.types[input.type]
  const rawValue = value?.kind === "raw" ? value.source : value?.kind === "literal" ? value.value : input.default ?? ""
  const enumOptions = useMemo(() => resolveEnumOptions(input, type), [input, type])
  const hasEnumOptions = enumOptions.length > 0
  const rawMode = value?.kind === "raw" || (!hasEnumOptions && !value && type?.inputStrategy === "raw")
  const allowRawMode = hasEnumOptions && input.type !== "keyword"
  const drop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = event.dataTransfer.getData(BLOCK_MIME)
    if (sourceId) onAttach(block.id, input, sourceId)
  }
  return (
    <div className="scratch-input-row">
      <label title={input.description}>{input.name}<small>{input.accepts.join(" | ")}</small></label>
      <div className="scratch-input-slot" data-fillable={type?.ketherFillable !== false} onDragOver={(event) => { if (type?.ketherFillable !== false) event.preventDefault() }} onDrop={drop}>
        {value?.kind === "block" ? (
          <BlockView blockId={value.blockId} document={document} schema={schema} catalog={catalog} onDelete={onDelete} onMove={onMove} onInput={onInput} onAttach={onAttach} renderStack={renderStack} />
        ) : hasEnumOptions ? (
          <div className="scratch-enum-control">
            {allowRawMode && (
              <div className="scratch-input-mode" role="group" aria-label={`${input.name}输入方式`}>
                <button type="button" aria-pressed={!rawMode} onClick={() => onInput(block.id, input, String(rawValue ?? ""))}>选项</button>
                <button type="button" aria-pressed={rawMode} onClick={() => onInput(block.id, input, String(rawValue ?? ""), true)}>Raw</button>
              </div>
            )}
            {rawMode ? (
              <textarea aria-label={`${input.name} Raw Kether 片段`} rows={2} value={String(rawValue ?? "")} onChange={(event) => onInput(block.id, input, event.target.value, true)} />
            ) : (
              <EnumCombobox
                label={input.name}
                value={String(rawValue ?? "")}
                options={enumOptions}
                onChange={(nextValue) => onInput(block.id, input, nextValue)}
              />
            )}
          </div>
        ) : type?.inputStrategy === "raw" || value?.kind === "raw" ? (
          <textarea rows={2} value={String(rawValue ?? "")} onChange={(event) => onInput(block.id, input, event.target.value, true)} />
        ) : input.type === "boolean" ? (
          <button type="button" className="scratch-bool" aria-pressed={rawValue === true || String(rawValue) === "true"} onClick={() => onInput(block.id, input, !(rawValue === true || String(rawValue) === "true"))}>{rawValue === true || String(rawValue) === "true" ? "真" : "假"}</button>
        ) : (
          <input type="text" inputMode={["number", "int", "long", "double", "float"].includes(input.type) ? "decimal" : undefined} value={String(rawValue ?? "")} onChange={(event) => onInput(block.id, input, event.target.value)} />
        )}
      </div>
    </div>
  )
}
