import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  flushEditorInputs,
  registerEditorInputFlush,
  resetEditorInputFlushRegistryForTests,
} from "@/lib/editor-input-flush"

describe("编辑器本地输入 flush", () => {
  beforeEach(() => resetEditorInputFlushRegistryForTests())

  it("同步调用所有已注册输入并汇总拒绝结果", () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => false)
    registerEditorInputFlush(first)
    registerEditorInputFlush(second)

    expect(flushEditorInputs()).toBe(false)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("解绑后不再提交已卸载输入", () => {
    const flush = vi.fn(() => true)
    const unregister = registerEditorInputFlush(flush)
    unregister()

    expect(flushEditorInputs()).toBe(true)
    expect(flush).not.toHaveBeenCalled()
  })
})
