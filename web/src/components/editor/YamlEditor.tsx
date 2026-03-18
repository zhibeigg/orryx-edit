import Editor from "@monaco-editor/react"

interface YamlEditorProps {
  content: string
  onChange: (value: string) => void
}

export function YamlEditor({ content, onChange }: YamlEditorProps) {
  return (
    <Editor
      height="100%"
      defaultLanguage="yaml"
      value={content}
      onChange={(value) => onChange(value ?? "")}
      theme="vs-dark"
      options={{
        fontSize: 14,
        fontFamily: "var(--font-mono)",
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  )
}
