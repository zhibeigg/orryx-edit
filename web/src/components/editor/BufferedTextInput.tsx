import { useEffect, useRef, useState, type InputHTMLAttributes } from "react"
import { useEditorInputFlush } from "@/lib/editor-input-flush"

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown"
>

interface BufferedTextInputProps extends NativeInputProps {
  value: string
  onCommit: (value: string) => boolean | void
  onCancel?: () => void
}

/** 可复用的本地文本缓冲；保存/关闭前通过全局 flush 同步提交。 */
export function BufferedTextInput({ value, onCommit, onCancel, ...props }: BufferedTextInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (fromGlobalFlush = false): boolean => {
    if (draft === value) return true
    const accepted = onCommit(draft) !== false
    if (!accepted && fromGlobalFlush) inputRef.current?.focus()
    return accepted
  }

  useEditorInputFlush(() => commit(true))

  return (
    <input
      {...props}
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          if (commit()) event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          event.preventDefault()
          setDraft(value)
          onCancel?.()
        }
      }}
    />
  )
}
