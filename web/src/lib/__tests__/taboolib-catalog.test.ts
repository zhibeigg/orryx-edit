import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { buildSchemaCatalog, validateSchemaRuntime } from "@/types/schema"

const schemaPath = resolve(__dirname, "../../../../schemas/taboolib-6.3.0/actions-schema.json")
const overlayPath = resolve(__dirname, "../../../../schemas/taboolib-6.3.0/grammar-overlay.json")
const raw = JSON.parse(readFileSync(schemaPath, "utf8"))
const overlay = JSON.parse(readFileSync(overlayPath, "utf8"))
const commit = "ae4bcf2c02e573e33f2c0dcbb02d89b8236e509b"

describe("TabooLib 6.3.0 baseline", () => {
  it("固定审计版本并完整覆盖源码注册目录", () => {
    expect(raw.pluginVersion).toBe("6.3.0")
    expect(raw.commit).toBe(commit)
    expect(raw.source.commit).toBe(commit)
    expect(raw.actions).toHaveLength(89)
    expect(raw.actions.reduce((count: number, action: { aliases: string[] }) => count + 1 + action.aliases.length, 0)).toBe(126)
    expect(raw.grammar).toMatchObject({ annotationGroups: 84, directRegistrationGroups: 5, aliasCount: 37 })
    expect(raw.operators).toHaveLength(65)
    expect(raw.properties).toHaveLength(7)
    expect(overlay.target.commit).toBe(commit)
  })

  it("仅包含真实 parser、直接注册名与别名", () => {
    const actions = new Map(raw.actions.map((action: { name: string }) => [action.name, action]))
    expect([...actions.keys()]).toEqual(expect.arrayContaining([
      "await_all", "scoreboard", "arr-remove-last", "$", "case", "year", "second",
    ]))
    expect(actions.get("tell")?.aliases).toEqual(["send", "message"])
    expect(actions.get("wait")?.aliases).toEqual(["delay", "sleep"])
    expect(actions.get("year")?.aliases).toEqual(["years"])
    expect(actions.get("year")?.source).toMatchObject({ registration: "direct" })
    expect(actions.get("when")?.namespace).toBe("kether_inner:when")
    expect(actions.has("bossbar")).toBe(false)
    expect(actions.has("particle")).toBe(false)
  })

  it("提取真实 PlayerOperators 与 KetherProperty", () => {
    const operatorNames = raw.operators.map((operator: { name: string }) => operator.name)
    expect(operatorNames).toEqual(expect.arrayContaining([
      "BLOCK_X", "COMPASS_TARGET", "BED_SPAWN", "IS_ONLINE", "ATTACK_COOLDOWN", "FACING",
    ]))
    expect(operatorNames).not.toEqual(expect.arrayContaining(["send-message", "give-item", "metadata"]))

    const propertyNames = raw.properties.map((property: { name: string }) => property.name)
    expect(propertyNames.sort()).toEqual([
      "array.operator",
      "item.operator",
      "itemMeta.operator",
      "list.operator",
      "map.operator",
      "matcher.operator",
      "string.operator",
    ])
    const mapProperty = raw.properties.find((property: { name: string }) => property.name === "map.operator")
    expect(mapProperty.keys).toContainEqual({ name: "@<key>", type: "any", writable: true })
  })

  it("通过 v4 runtime contract，并将未知语法限制为本地 raw", () => {
    const result = validateSchemaRuntime(raw)
    expect(result.errors).toEqual([])
    expect(result.schema).toBeDefined()
    if (!result.schema) return
    const catalog = buildSchemaCatalog(result.schema)
    expect(catalog.byName.get("player")).toHaveLength(1)
    expect(catalog.byAlias.get("sleep")?.[0]?.name).toBe("wait")
    expect(catalog.byAlias.get("message")?.[0]?.name).toBe("tell")
    expect(catalog.byAlias.get("years")?.[0]?.name).toBe("year")
    expect(result.schema.grammar?.rawFallback).toBe("local-block")
    expect(catalog.byName.get("scoreboard")?.[0]).toMatchObject({
      shape: "raw",
      grammar: { localRawRemainder: true, fallback: "local-block" },
    })
    expect(overlay.fallback).toEqual({
      scope: "local",
      representation: "raw-block",
      preserveSource: true,
      fabricateUnknownGrammar: false,
    })
  })
})
