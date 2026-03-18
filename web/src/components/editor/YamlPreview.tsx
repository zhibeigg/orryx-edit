import Editor from "@monaco-editor/react"

interface YamlPreviewProps {
  content: string
}

export function YamlPreview({ content }: YamlPreviewProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
        YAML 预览（只读）
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language="yaml"
          value={content}
          theme="vs-dark"
          options={{
            readOnly: true,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 4 },
          }}
        />
      </div>
    </div>
  )
}
