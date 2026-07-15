import { describe, expect, it } from "vitest"
import {
  commitNumberDraft,
  commitVariableValueDraft,
  isPotentialNumberDraft,
  renameRecordKey,
} from "@/components/editor/editor-input-utils"

describe("变量键草稿提交", () => {
  it("提交时重命名且保持条目顺序和值", () => {
    const source = { Damage: "1.", Range: 5 }
    const renamed = renameRecordKey(source, "Damage", "Power")

    expect(renamed).toEqual({ Power: "1.", Range: 5 })
    expect(Object.keys(renamed ?? {})).toEqual(["Power", "Range"])
  })

  it("空键名或冲突键名不会提交", () => {
    const source = { Damage: 1, Range: 5 }
    expect(renameRecordKey(source, "Damage", " ")).toBeNull()
    expect(renameRecordKey(source, "Damage", "Range")).toBeNull()
  })
})

describe("数字输入中间态", () => {
  it("允许空串、符号和尾随小数点作为草稿", () => {
    expect(isPotentialNumberDraft("")).toBe(true)
    expect(isPotentialNumberDraft("-")).toBe(true)
    expect(isPotentialNumberDraft("1.")).toBe(true)
  })

  it("仅在提交时解析，空草稿恢复外部值", () => {
    expect(commitNumberDraft("")).toBeNull()
    expect(commitNumberDraft("1.")).toBe(1)
    expect(commitNumberDraft("12", { mode: "integer" })).toBe(12)
  })

  it("变量值保留空串与表达式，完整数字才转 number", () => {
    expect(commitVariableValueDraft("")).toBe("")
    expect(commitVariableValueDraft("1.")).toBe(1)
    expect(commitVariableValueDraft('calc "1+2"')).toBe('calc "1+2"')
  })
})
