import { useEffect, useRef, useState } from "react"
import { useEditorInputFlush } from "@/lib/editor-input-flush"
import { commitNumberDraft, type NumberMode } from "./editor-input-utils"

interface BufferedNumberInputProps {
  value: number | undefined
  onCommit: (value: number) => void
  mode?: NumberMode
  min?: number
  max?: number
  step?: number
  className?: string
  title?: string
  placeholder?: string
}

/** 以字符串保存输入草稿，仅在 blur/Enter 时提交数值。 */
export function BufferedNumberInput({
  value,
  onCommit,
  mode = "float",
  min,
  max,
  step,
  className,
  title,
  placeholder,
}: BufferedNumberInputProps) {
  const externalValue = value ?? 0
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState(String(externalValue))

  useEffect(() => {
    setDraft(String(externalValue))
  }, [externalValue])

  const commit = (fromGlobalFlush = false): boolean => {
    const parsed = commitNumberDraft(draft, { mode, min, max })
    if (parsed === null) {
      if (fromGlobalFlush) {
        inputRef.current?.focus()
        return false
      }
      setDraft(String(externalValue))
      return true
    }
    setDraft(String(parsed))
    if (parsed !== externalValue) onCommit(parsed)
    return true
  }

  useEditorInputFlush(() => commit(true))

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={mode === "integer" ? "numeric" : "decimal"}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit()
          event.currentTarget.blur()
        }
      }}
      min={min}
      max={max}
      step={step}
      className={className}
      title={title}
      placeholder={placeholder}
    />
  )
}
