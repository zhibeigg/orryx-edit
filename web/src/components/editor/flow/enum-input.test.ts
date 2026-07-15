import { describe, expect, it } from "vitest"
import type { SchemaInput, SchemaType } from "@/types/schema"
import { ENUM_RESULT_LIMIT, filterEnumOptions, nextEnumActiveIndex, resolveEnumOptions } from "./enum-input"

const type: SchemaType = {
  widget: "select",
  color: "#fff",
  ketherFillable: true,
  inputStrategy: "expression",
  serialization: "token",
  enumValues: ["ZOMBIE", "SKELETON", "ZOMBIE"],
}

const input = (overrides: Partial<SchemaInput> = {}): SchemaInput => ({
  name: "实体类型",
  key: "entityType",
  type: "text",
  accepts: ["text"],
  required: true,
  default: null,
  ...overrides,
})

describe("enum input metadata", () => {
  it("按 input options、type enumValues、keyword 的顺序解析", () => {
    expect(resolveEnumOptions(input({ options: [" CREEPER ", "ZOMBIE", "CREEPER"] }), type)).toEqual(["CREEPER", "ZOMBIE"])
    expect(resolveEnumOptions(input(), type)).toEqual(["ZOMBIE", "SKELETON"])
    expect(resolveEnumOptions(input({ type: "keyword", keyword: "set/to", keywords: { alternatives: ["set", "to"], mode: "flag" } }))).toEqual(["set", "to"])
  })

  it("大目录只渲染结果窗口并保留真实计数", () => {
    const options = Array.from({ length: 120 }, (_, index) => `ENTITY_${index}`)
    const all = filterEnumOptions(options, "")
    expect(all.values).toHaveLength(ENUM_RESULT_LIMIT)
    expect(all.total).toBe(120)
    expect(all.truncated).toBe(true)

    const narrowed = filterEnumOptions(options, "ENTITY_11")
    expect(narrowed.values).toEqual(["ENTITY_11", "ENTITY_110", "ENTITY_111", "ENTITY_112", "ENTITY_113", "ENTITY_114", "ENTITY_115", "ENTITY_116", "ENTITY_117", "ENTITY_118", "ENTITY_119"])
  })

  it("方向键、Home 与 End 在结果内稳定移动", () => {
    expect(nextEnumActiveIndex(-1, 3, "ArrowDown")).toBe(0)
    expect(nextEnumActiveIndex(2, 3, "ArrowDown")).toBe(0)
    expect(nextEnumActiveIndex(-1, 3, "ArrowUp")).toBe(2)
    expect(nextEnumActiveIndex(0, 3, "ArrowUp")).toBe(2)
    expect(nextEnumActiveIndex(1, 3, "Home")).toBe(0)
    expect(nextEnumActiveIndex(1, 3, "End")).toBe(2)
    expect(nextEnumActiveIndex(1, 0, "End")).toBe(-1)
  })
})
