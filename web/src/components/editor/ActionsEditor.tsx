import { useRef, useEffect, useState, lazy, Suspense } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, loadActionsSchema, KETHER_LANGUAGE_ID, getActionsSchema } from "@/lib/kether-language"
import { Code, Blocks } from "lucide-react"

const KetherBlockEditor = lazy(() => import("./KetherBlockEditor").then(m => ({ default: m.KetherBlockEditor })))

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [mode, setMode] = useState<"text" | "blocks">("text")

  const handleMount: OnMount = async (editor, monaco) => {
    editorRef.current = editor

    if (!ketherRegistered) {
      await loadActionsSchema()
      registerKetherLanguage(monaco)
      ketherRegistered = true
    }

    monaco.editor.setTheme("kether-dark")
    const model = editor.getModel()
    if (model) {
      monaco.editor.setModelLanguage(model, KETHER_LANGUAGE_ID)
    }
  }

  useEffect(() => {
    return () => {
      editorRef.current = null
    }
  }, [])

  return (
    <div style={{ height }} className="flex flex-col">
      {/* 模式切换 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#3c3c3c] bg-[#252526] shrink-0">
        <button
          onClick={() => setMode("text")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${mode === "text" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}
        >
          <Code className="w-3 h-3" />文本
        </button>
        <button
          onClick={() => setMode("blocks")}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] ${mode === "blocks" ? "bg-[#007acc] text-white" : "text-[#858585] hover:text-[#cccccc]"}`}
        >
          <Blocks className="w-3 h-3" />积木
        </button>
      </div>

      {/* 编辑器内容 */}
      <div className="flex-1 min-h-0">
        {mode === "text" ? (
          <Editor
            height="100%"
            defaultLanguage="plaintext"
            value={value}
            onChange={(v) => onChange(v ?? "")}
            theme="vs-dark"
            onMount={handleMount}
            options={{
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              insertSpaces: true,
              automaticLayout: true,
              padding: { top: 4 },
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true },
              unicodeHighlight: { ambiguousCharacters: false },
              wordBasedSuggestions: "currentDocument",
            }}
          />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-[13px] text-[#858585]">加载积木编辑器...</div>}>
            <KetherBlockEditor value={value} onChange={onChange} schema={getActionsSchema() as any} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
