import { useRef, useEffect, useState, lazy, Suspense, useMemo } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, loadActionsSchema, KETHER_LANGUAGE_ID, getActionsSchema } from "@/lib/kether-language"
import { Code, Workflow } from "lucide-react"
import type { ActionsSchemaV2 } from "@/types/schema"

const FlowEditor = lazy(() => import("./flow/FlowEditor").then(m => ({ default: m.FlowEditor })))

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [mode, setMode] = useState<"text" | "flow">("text")

  const schema = useMemo(() => getActionsSchema() as ActionsSchemaV2 | null, [])

  const handleMount: OnMount = async (editor, monaco) => {
    editorRef.current = editor
    if (!ketherRegistered) {
      await loadActionsSchema()
      registerKetherLanguage(monaco)
      ketherRegistered = true
    }
    monaco.editor.setTheme("kether-dark")
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, KETHER_LANGUAGE_ID)
  }

  useEffect(() => { return () => { editorRef.current = null } }, [])

  return (
    <div style={{ height }} className="flex flex-col">
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
    </div>
  )
}
