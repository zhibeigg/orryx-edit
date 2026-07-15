import { describe, expect, it } from "vitest"
import {
  buildSchemaCatalog,
  canFillInput,
  isTypeAssignable,
  normalizeSchema,
  selectActionVariant,
} from "@/types/schema"

const schema = normalizeSchema({
  version: 2,
  schemaVersion: 4,
  types: {
    any: { widget: "text", color: "#fff", extends: [], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
    number: { widget: "number", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    int: { widget: "number", color: "#fff", extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    location: { widget: "location", color: "#fff", extends: ["any"], ketherFillable: false, inputStrategy: "raw", serialization: "raw" },
    keyword: { widget: "select", color: "#fff", extends: ["any"], ketherFillable: false, inputStrategy: "literal", serialization: "token" },
  },
  categories: { test: { color: "#fff", icon: "test" } },
  actions: [
    { id: "test.action.value.get", variantId: "test.action.value.get", name: "value", aliases: ["v"], category: "test", namespace: "test", description: "get", syntax: "value get", flow: "normal", shape: "reporter", inputs: [{ name: "get", key: "get", type: "keyword", accepts: ["keyword"], required: true, default: "get", keyword: "get", keywords: { alternatives: ["get"], mode: "flag" } }], output: { type: "int" } },
    { id: "test.action.value.set", variantId: "test.action.value.set", name: "value", aliases: ["v"], category: "test", namespace: "test", description: "set", syntax: "value set <int>", flow: "normal", shape: "command", inputs: [{ name: "set", key: "set", type: "keyword", accepts: ["keyword"], required: true, default: "set", keyword: "set/to", keywords: { alternatives: ["set", "to"], mode: "flag" } }, { name: "value", key: "value", type: "int", accepts: ["int"], required: true, default: 0 }], output: null },
  ],
  selectors: [], triggers: [], properties: [],
})

describe("SchemaCatalog", () => {
  it("保留同名重载、alias、keyword 与稳定 variant 索引", () => {
    const catalog = buildSchemaCatalog(schema)
    expect(catalog.byName.get("value")).toHaveLength(2)
    expect(catalog.byAlias.get("v")).toHaveLength(2)
    expect(catalog.byKeyword.get("set")?.[0]?.variantId).toBe("test.action.value.set")
    expect(catalog.byVariantId.get("test.action.value.get")?.shape).toBe("reporter")
    expect(selectActionVariant(catalog, "v", ["set", "3"])?.variantId).toBe("test.action.value.set")
  })
})

describe("type lattice", () => {
  it("按集合子集关系计算 assignability", () => {
    expect(isTypeAssignable(schema.types, "int", "number")).toBe(true)
    expect(isTypeAssignable(schema.types, "int", "any")).toBe(true)
    expect(isTypeAssignable(schema.types, "number", "int")).toBe(false)
    expect(canFillInput(schema.types, "int", { accepts: ["number"] })).toBe(true)
  })

  it("不可 Kether 填充的 raw 类型不会被误当作 expression", () => {
    expect(schema.types.location.ketherFillable).toBe(false)
    expect(schema.types.location.inputStrategy).toBe("raw")
    expect(schema.types.location.serialization).toBe("raw")
  })
})
