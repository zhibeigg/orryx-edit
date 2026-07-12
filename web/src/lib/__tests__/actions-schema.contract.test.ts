import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { ActionsSchemaV2 } from "@/types/schema"

const schemaPath = resolve(__dirname, "../../../../schemas/actions-schema.json")
const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as ActionsSchemaV2

describe("actions schema v2 contract", () => {
  it("声明 v2 顶层结构", () => {
    expect(schema.version).toBe(2)
    expect(schema.types).toBeTypeOf("object")
    expect(schema.categories).toBeTypeOf("object")
    expect(Array.isArray(schema.actions)).toBe(true)
    expect(Array.isArray(schema.selectors)).toBe(true)
    expect(Array.isArray(schema.triggers)).toBe(true)
  })

  it("所有 action 均满足编辑器所需字段", () => {
    expect(schema.actions.length).toBeGreaterThan(0)

    for (const action of schema.actions) {
      expect(action.name).toBeTypeOf("string")
      expect(action.category).toBeTypeOf("string")
      expect(action.namespace).toBeTypeOf("string")
      expect(action.description).toBeTypeOf("string")
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
      expect(selector.name).toBeTypeOf("string")
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
