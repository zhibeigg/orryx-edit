import { useRef, useEffect, useState, lazy, Suspense, useMemo, useCallback } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, loadActionsSchema, KETHER_LANGUAGE_ID, getActionsSchema, onWizardTrigger, type WizardTrigger } from "@/lib/kether-language"
import { Code, Workflow } from "lucide-react"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import { ParameterWizard } from "./ParameterWizard"
import { findAction, parseLineValues } from "@/lib/parameter-wizard"

const FlowEditor = lazy(() => import("./flow/FlowEditor").then(m => ({ default: m.FlowEditor })))

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null)
  const schemaRef = useRef<ActionsSchemaV2 | null>(null)
  const [mode, setMode] = useState<"text" | "flow">("text")
  const [wizardState, setWizardState] = useState<{
    action: SchemaAction; values: Record<string, unknown>; lineNumber: number
  } | null>(null)

  const schema = useMemo(() => getActionsSchema() as ActionsSchemaV2 | null, [])

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
        const action = findAction(firstToken, currentSchema)
        if (action) {
          const vals = parseLineValues(line, action)
          setWizardState({ action, values: vals, lineNumber: pos.lineNumber })
        }
      },
    })
  }

  useEffect(() => {
    if (!schema) return
    const unsub = onWizardTrigger((trigger: WizardTrigger) => {
      const action = findAction(trigger.actionName, schema)
      if (!action) return
      const editor = editorRef.current
      if (!editor) return
      const line = editor.getModel()?.getLineContent(trigger.lineNumber) ?? ""
      const vals = parseLineValues(line, action)
      setWizardState({ action, values: vals, lineNumber: trigger.lineNumber })
    })
    return unsub
  }, [schema])

  const handleWizardInsert = useCallback((text: string) => {
    if (!wizardState || !editorRef.current || !monacoRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    const ln = wizardState.lineNumber
    const range = new monacoRef.current.Range(ln, 1, ln, model.getLineMaxColumn(ln))
    editorRef.current.executeEdits("wizard", [{ range, text }])
    setWizardState(null)
  }, [wizardState])

  useEffect(() => { return () => { editorRef.current = null } }, [])

  return (
    <div style={{ height }} className="flex flex-col relative">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
        <button onClick={() => setMode("text")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded ${mode === "text" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}>
          <Code className="w-3 h-3" />文本
        </button>
        <button onClick={() => setMode("flow")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded ${mode === "flow" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}>
          <Workflow className="w-3 h-3" />节点
        </button>
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
