import { useEffect, useState } from "react"
import { useEditorInputFlush } from "@/lib/editor-input-flush"

interface BufferedListInputProps {
  value: string[]
  onCommit: (value: string[]) => void
  parse: (draft: string) => string[]
  join: (value: string[]) => string
  multiline?: boolean
  className?: string
  placeholder?: string
}

/** 保留逗号尾部、空行等输入中间态，在 blur 时再投影为列表。 */
export function BufferedListInput({ value, onCommit, parse, join, multiline, className, placeholder }: BufferedListInputProps) {
  const serialized = join(value)
  const [draft, setDraft] = useState(serialized)

  useEffect(() => {
    setDraft(serialized)
  }, [serialized])

  const commit = () => {
    onCommit(parse(draft))
    return true
  }
  useEditorInputFlush(commit)

  const common = {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: commit,
    className,
    placeholder,
  }

  return multiline ? <textarea {...common} /> : <input {...common} />
}
