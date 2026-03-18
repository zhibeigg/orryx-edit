import { DiffEditor } from "@monaco-editor/react"

interface DiffViewProps {
  original: string
  modified: string
  language?: string
}

export function DiffView({ original, modified, language = "yaml" }: DiffViewProps) {
  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      theme="vs-dark"
      options={{
        readOnly: true,
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderSideBySide: true,
        automaticLayout: true,
        padding: { top: 4 },
      }}
    />
  )
}
