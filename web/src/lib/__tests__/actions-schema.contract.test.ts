import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { ActionsSchemaV2 } from "@/types/schema"

const schemaPath = resolve(__dirname, "../../../../schemas/actions-schema.json")
const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as ActionsSchemaV2

describe("actions schema v2 contract", () => {
  it("声明 v2 兼容入口和 v3 动态契约元数据", () => {
    expect(schema.version).toBe(2)
    expect(schema.schemaVersion).toBe(3)
    expect(schema.pluginVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(schema.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(schema.types).toBeTypeOf("object")
    expect(schema.categories).toBeTypeOf("object")
    expect(Array.isArray(schema.actions)).toBe(true)
    expect(Array.isArray(schema.selectors)).toBe(true)
    expect(Array.isArray(schema.triggers)).toBe(true)
  })

  it("所有 action 均满足编辑器所需字段", () => {
    expect(schema.actions.length).toBeGreaterThan(0)

    const ids = new Set<string>()
    for (const action of schema.actions) {
      expect(action.id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
      expect(ids.has(action.id!)).toBe(false)
      ids.add(action.id!)
      expect(action.name).toBeTypeOf("string")
      expect(action.category).toBeTypeOf("string")
      expect(action.namespace).toBeTypeOf("string")
      expect(action.description).toBeTypeOf("string")
      expect(action.syntax).toBeTypeOf("string")
      expect(["normal", "branch", "loop", "container"]).toContain(action.flow)
      expect(Array.isArray(action.inputs)).toBe(true)
      expect(action.output === null || typeof action.output === "object").toBe(true)

      for (const input of action.inputs) {
        expect(input.name).toBeTypeOf("string")
        expect(input.key).toBeTypeOf("string")
        expect(input.type).toBeTypeOf("string")
        expect(input.required).toBeTypeOf("boolean")
        expect(Object.hasOwn(input, "default")).toBe(true)
        expect(schema.types[input.type]).toBeDefined()
      }
    }
  })

  it("action 分类和 selector 参数类型均可解析", () => {
    for (const action of schema.actions) {
      expect(schema.categories[action.category]).toBeDefined()
    }

    for (const selector of schema.selectors) {
      expect(selector.id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
      expect(selector.name).toBeTypeOf("string")
      expect(selector.syntax).toBeTypeOf("string")
      expect(selector.description).toBeTypeOf("string")
      expect(Array.isArray(selector.params)).toBe(true)
      for (const param of selector.params) {
        expect(param.name).toBeTypeOf("string")
        expect(param.key).toBeTypeOf("string")
        expect(schema.types[param.type]).toBeDefined()
      }
    }
  })
})
