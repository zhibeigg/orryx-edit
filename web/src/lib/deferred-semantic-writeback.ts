export interface DeferredSemanticWriteback<T> {
  schedule: (snapshot: T) => void
  flush: () => boolean
  hasPending: () => boolean
  dispose: () => boolean
}

/**
 * 保存最后一个待回写语义快照。清理定时器只会停止延迟执行，不会丢弃快照；
 * 只有提交成功后才清空 pending，供全局 input flush 与卸载路径同步提交。
 */
export function createDeferredSemanticWriteback<T>(
  delayMs: number,
  commit: (snapshot: T) => boolean | void,
): DeferredSemanticWriteback<T> {
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    if (pending === undefined) return true

    try {
      if (commit(pending) === false) return false
      pending = undefined
      return true
    } catch {
      return false
    }
  }

  return {
    schedule(snapshot) {
      pending = snapshot
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        flush()
      }, delayMs)
    },
    flush,
    hasPending: () => pending !== undefined,
    dispose: flush,
  }
}
