import { useEffect, useRef } from "react"

export type EditorInputFlush = () => boolean | void

const flushers = new Map<symbol, EditorInputFlush>()

export function registerEditorInputFlush(flush: EditorInputFlush): () => void {
  const key = Symbol("editor-input-flush")
  flushers.set(key, flush)
  return () => {
    flushers.delete(key)
  }
}

/** 同步提交所有已挂载编辑器中的本地输入缓冲；任一输入拒绝提交时返回 false。 */
export function flushEditorInputs(): boolean {
  let accepted = true
  for (const flush of [...flushers.values()]) {
    try {
      if (flush() === false) accepted = false
    } catch {
      accepted = false
    }
  }
  return accepted
}

export function useEditorInputFlush(flush: EditorInputFlush) {
  const flushRef = useRef(flush)

  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => registerEditorInputFlush(() => flushRef.current()), [])
}

/** 仅供测试清理模块级注册表。 */
export function resetEditorInputFlushRegistryForTests() {
  flushers.clear()
}
