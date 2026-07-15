import { afterEach, describe, expect, it, vi } from "vitest"
import { createDeferredSemanticWriteback } from "@/lib/deferred-semantic-writeback"

describe("FlowEditor 延迟语义回写", () => {
  afterEach(() => vi.useRealTimers())

  it("全局 flush 可在 220ms 前同步提交，之后定时器不会重复回写", () => {
    vi.useFakeTimers()
    const commit = vi.fn(() => true)
    const writeback = createDeferredSemanticWriteback(220, commit)

    writeback.schedule("semantic-change")
    expect(writeback.flush()).toBe(true)
    expect(commit).toHaveBeenCalledWith("semantic-change")

    vi.advanceTimersByTime(220)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("取消延迟执行不会丢弃未成功提交的语义快照", () => {
    vi.useFakeTimers()
    const commit = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const writeback = createDeferredSemanticWriteback(220, commit)

    writeback.schedule("pending")
    expect(writeback.flush()).toBe(false)
    expect(writeback.hasPending()).toBe(true)
    expect(writeback.dispose()).toBe(true)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(writeback.hasPending()).toBe(false)
  })

  it("未调度语义快照时 flush 不产生回写，布局变化可保持纯本地", () => {
    const commit = vi.fn(() => true)
    const writeback = createDeferredSemanticWriteback(220, commit)

    expect(writeback.flush()).toBe(true)
    expect(commit).not.toHaveBeenCalled()
  })
})
