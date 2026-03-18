import { useRef, useEffect } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { registerKetherLanguage, KETHER_LANGUAGE_ID } from "@/lib/kether-language"

interface ActionsEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
}

let ketherRegistered = false

export function ActionsEditor({ value, onChange, height = "300px" }: ActionsEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor

    if (!ketherRegistered) {
      registerKetherLanguage(monaco)
      ketherRegistered = true
    }

    // 切换到 kether 语言和主题
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
    <Editor
      height={height}
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
      }}
    />
  )
}
