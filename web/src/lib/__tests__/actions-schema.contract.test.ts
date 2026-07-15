import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeSchema } from "@/types/schema"

const legacyPath = resolve(__dirname, "../../../../schemas/actions-schema.json")
const registryPath = resolve(__dirname, "../../../../schemas/kether-registry.json")
const legacy = JSON.parse(readFileSync(legacyPath, "utf-8"))
const registry = JSON.parse(readFileSync(registryPath, "utf-8"))
const schema = normalizeSchema(registry)

describe("actions schema v2 contract", () => {
  it("同时固化 legacy v3 与 Registry v4", () => {
    expect(legacy.version).toBe(2)
    expect(legacy.schemaVersion).toBe(3)
    expect(registry.registryVersion).toBe(4)
    expect(registry.schemaVersion).toBe(4)
    expect(schema.version).toBe(2)
    expect(schema.schemaVersion).toBe(4)
    expect(schema.pluginVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(schema.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(schema.types).toBeTypeOf("object")
    expect(schema.categories).toBeTypeOf("object")
    expect(Array.isArray(schema.actions)).toBe(true)
    expect(Array.isArray(schema.selectors)).toBe(true)
    expect(Array.isArray(schema.triggers)).toBe(true)
  })

  it("所有类型均显式声明类型格和输入策略", () => {
    for (const [name, type] of Object.entries(schema.types)) {
      expect(type.ketherFillable, name).toBeTypeOf("boolean")
      expect(["expression", "literal", "raw"], name).toContain(type.inputStrategy)
      expect(["token", "quoted", "raw", "json", "duration"], name).toContain(type.serialization)
      expect(Array.isArray(type.extends), name).toBe(true)
    }
  })

  it("所有 action 均满足编辑器所需字段", () => {
    expect(schema.actions.length).toBeGreaterThan(0)

    const ids = new Set<string>()
    for (const action of schema.actions) {
      expect(action.id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
      expect(ids.has(action.id!)).toBe(false)
      ids.add(action.id!)
      expect(action.variantId).toBeTypeOf("string")
      expect(["command", "reporter", "predicate", "container", "raw"]).toContain(action.shape)
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
        expect(input.accepts.length).toBeGreaterThan(0)
        expect(schema.types[input.type]).toBeDefined()
        for (const accepted of input.accepts) expect(schema.types[accepted]).toBeDefined()
      }
    }
  })

  it("实体、药水、声音与材质输入发布有限值目录", () => {
    const optionsFor = (actionName: string, inputName: string, syntaxIncludes?: string) => schema.actions
      .find((action) => action.name === actionName
        && (!syntaxIncludes || action.syntax.includes(syntaxIncludes))
        && action.inputs.some((input) => input.name === inputName))
      ?.inputs.find((input) => input.name === inputName)?.options ?? []

    expect(optionsFor("entity", "实体类型", "spawn")).toContain("ZOMBIE")
    expect(optionsFor("potion", "效果", "set")).toContain("SPEED")
    expect(optionsFor("sound", "音效名称")).toContain("ENTITY_EXPERIENCE_ORB_PICKUP")
    expect(optionsFor("itemstack", "材质名")).toContain("DIAMOND_SWORD")
  })

  it("保留审计到的同名重载而不是按 name 覆盖", () => {
    const groups = new Map<string, number>()
    for (const action of schema.actions) groups.set(action.name.toLowerCase(), (groups.get(action.name.toLowerCase()) ?? 0) + 1)
    expect([...groups.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(32)
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
