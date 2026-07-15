import { useRef, useEffect, useState, lazy, Suspense, useCallback } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, loadActionsSchema, KETHER_LANGUAGE_ID, getActionsSchema, onWizardTrigger, type WizardTrigger } from "@/lib/kether-language"
import { Code, Workflow } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import { normalizeSchema } from "@/types/schema"
import { ParameterWizard } from "./ParameterWizard"
import { findBestOverload, parseLineValues } from "@/lib/parameter-wizard"
import { flushEditorInputs } from "@/lib/editor-input-flush"

const FlowEditor = lazy(() => import("./flow/FlowEditor").then(m => ({ default: m.FlowEditor })))

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

// 内置控制流关键字 — 参数向导无法处理
const BUILTIN_KEYWORDS = new Set([
  "if", "else", "for", "set", "case", "check", "any", "all",
  "math", "calc", "inline", "lazy", "sync", "async",
  "exit", "break", "return", "def", "not", "then", "when",
])

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null)
  const schemaRef = useRef<ActionsSchemaV2 | null>(null)
  const [mode, setMode] = useState<"text" | "flow">("text")
  const [wizardState, setWizardState] = useState<{
    action: SchemaAction; values: Record<string, unknown>; lineNumber: number
  } | null>(null)

  const [schema, setSchema] = useState<ActionsSchemaV2 | null>(() => {
    const raw = getActionsSchema()
    return raw ? normalizeSchema(raw) : null
  })

  // 确保 schema 加载完成后更新状态
  useEffect(() => {
    if (schema) return
    let cancelled = false
    loadActionsSchema().then(() => {
      if (!cancelled) {
        const raw = getActionsSchema()
        setSchema(raw ? normalizeSchema(raw) : null)
      }
    })
    return () => { cancelled = true }
  }, [schema])

  // keep ref in sync so keybinding closure can access latest schema
  useEffect(() => { schemaRef.current = schema }, [schema])

  const handleMount: OnMount = async (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (!ketherRegistered) {
      await loadActionsSchema()
      registerKetherLanguage(monaco)
      ketherRegistered = true
    }
    monaco.editor.setTheme("kether-dark")
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, KETHER_LANGUAGE_ID)

    editor.addAction({
      id: "kether.openWizardKeybinding",
      label: "打开参数向导",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space],
      run: (ed) => {
        const currentSchema = schemaRef.current
        if (!currentSchema) return
        const pos = ed.getPosition()
        if (!pos) return
        const line = ed.getModel()?.getLineContent(pos.lineNumber) ?? ""
        const firstToken = line.trim().split(/\s+/)[0]
        if (!firstToken) return
        if (BUILTIN_KEYWORDS.has(firstToken.toLowerCase())) return
        const action = findBestOverload(firstToken, line, currentSchema)
        if (action) {
          const vals = parseLineValues(line, action, currentSchema)
          setWizardState({ action, values: vals, lineNumber: pos.lineNumber })
        }
      },
    })
  }

  useEffect(() => {
    if (!schema) return
    const unsub = onWizardTrigger((trigger: WizardTrigger) => {
      const editor = editorRef.current
      if (!editor) return
      const line = editor.getModel()?.getLineContent(trigger.lineNumber) ?? ""
      const action = findBestOverload(trigger.actionName, line, schema)
      if (!action) return
      const vals = parseLineValues(line, action, schema)
      setWizardState({ action, values: vals, lineNumber: trigger.lineNumber })
    })
    return unsub
  }, [schema])

  const handleWizardInsert = useCallback((text: string) => {
    if (!wizardState || !editorRef.current || !monacoRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    const ln = wizardState.lineNumber
    const lineContent = model.getLineContent(ln)
    // 保留原行的前导缩进
    const indent = lineContent.match(/^(\s*)/)?.[1] ?? ""
    const range = new monacoRef.current.Range(ln, 1, ln, model.getLineMaxColumn(ln))
    editorRef.current.executeEdits("wizard", [{ range, text: indent + text }])
    setWizardState(null)
  }, [wizardState])

  useEffect(() => { return () => { editorRef.current = null } }, [])

  const switchMode = useCallback((nextMode: "text" | "flow") => {
    if (nextMode === mode || !flushEditorInputs()) return
    setMode(nextMode)
  }, [mode])

  return (
    <div style={{ height }} className="flex flex-col relative">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#2f3136] bg-[linear-gradient(180deg,#252a33_0%,#1f232b_100%)] shrink-0">
        <button onClick={() => switchMode("text")}
          className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md transition-all ${mode === "text" ? "bg-[#3b82f6] text-white shadow-[0_4px_10px_rgba(59,130,246,0.35)]" : "text-[#94a0b4] hover:text-[#d4dbe8] hover:bg-[#2a303a]"}`}>
          <Code className="w-3 h-3" />文本
        </button>
        <button onClick={() => switchMode("flow")}
          className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md transition-all ${mode === "flow" ? "bg-[#3b82f6] text-white shadow-[0_4px_10px_rgba(59,130,246,0.35)]" : "text-[#94a0b4] hover:text-[#d4dbe8] hover:bg-[#2a303a]"}`}>
          <Workflow className="w-3 h-3" />节点
        </button>
        {mode === "flow" && <div className="ml-auto text-[10px] text-[#8f9cb0]">拖拽创建 · 连线编辑 · 自动回写</div>}
      </div>

      <div className="flex-1 min-h-0">
        {mode === "text" ? (
          <Editor height="100%" defaultLanguage="plaintext" value={value}
            onChange={v => onChange(v ?? "")} theme="vs-dark" onMount={handleMount}
            options={{
              fontSize: 13, fontFamily: "var(--font-mono)", minimap: { enabled: false },
              lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on",
              tabSize: 2, insertSpaces: true, automaticLayout: true, padding: { top: 4 },
              bracketPairColorization: { enabled: true }, guides: { bracketPairs: true },
              unicodeHighlight: { ambiguousCharacters: false }, wordBasedSuggestions: "currentDocument",
            }} />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-[13px] text-[#858585]">加载节点编辑器...</div>}>
            {schema && <FlowEditor value={value} onChange={onChange} schema={schema} />}
            {!schema && <div className="flex items-center justify-center h-full text-[13px] text-[#858585]">Schema 未加载</div>}
          </Suspense>
        )}
      </div>

      {wizardState && schema && mode === "text" && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50">
          <ParameterWizard
            action={wizardState.action}
            schema={schema}
            initialValues={wizardState.values}
            onInsert={handleWizardInsert}
            onCancel={() => setWizardState(null)}
          />
        </div>
      )}
    </div>
  )
}
