import { describe, expect, it } from "vitest"
import { normalizeSchema } from "@/types/schema"
import { canDockBlock, parseBlockDocument, reorderDocumentBlocks, serializeBlockDocument } from "./block-document"

const schema = normalizeSchema({
  version: 2,
  schemaVersion: 4,
  types: {
    any: { widget: "text", color: "#fff", extends: [], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
    text: { widget: "text", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "quoted" },
    number: { widget: "number", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    long: { widget: "number", color: "#fff", extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    keyword: { widget: "select", color: "#fff", extends: ["any"], ketherFillable: false, inputStrategy: "literal", serialization: "token" },
    container: { widget: "text", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
    boolean: { widget: "toggle", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    location: { widget: "location", color: "#fff", extends: ["any"], ketherFillable: false, inputStrategy: "raw", serialization: "raw" },
  },
  categories: { test: { color: "#fff", icon: "test" } },
  actions: [
    { id: "test.action.report", variantId: "test.action.report", name: "report", aliases: [], category: "test", namespace: "test", description: "report", syntax: "report <number>", flow: "normal", shape: "reporter", inputs: [{ name: "value", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }], output: { type: "number" } },
    { id: "test.action.use", variantId: "test.action.use", name: "use", aliases: [], category: "test", namespace: "test", description: "use", syntax: "use <number>", flow: "normal", shape: "command", inputs: [{ name: "value", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }], output: null },
    { id: "test.action.buff-send", variantId: "test.action.buff-send", name: "buff", aliases: [], category: "test", namespace: "test", description: "buff send", syntax: "buff send <text> [long] [they <container>]", flow: "normal", shape: "command", inputs: [{ name: "send", key: "send", type: "keyword", accepts: ["keyword"], required: true, default: null, keyword: "send", keywords: { mode: "flag", alternatives: ["send"] } }, { name: "buff", key: "buff", type: "text", accepts: ["text"], required: true, default: null }, { name: "duration", key: "duration", type: "long", accepts: ["long"], required: false, default: null }, { name: "target", key: "target", type: "container", accepts: ["container"], required: false, default: null, keyword: "they", keywords: { mode: "value", alternatives: ["they"] } }], output: null },
    { id: "test.action.opaque", variantId: "test.action.opaque", name: "opaque", aliases: [], category: "test", namespace: "test", description: "opaque", syntax: "opaque <raw...>", flow: "normal", shape: "raw", inputs: [{ name: "arguments", key: "arguments", type: "raw", accepts: ["raw"], required: false, default: null }], output: null, grammar: { localRawRemainder: true } },
    { id: "test.action.grammar-only", variantId: "test.action.grammar-only", name: "grammar-only", aliases: [], category: "test", namespace: "test", description: "grammar only", syntax: "grammar-only <value> then <action>", flow: "normal", shape: "command", inputs: [], output: null, grammar: { sequence: ["grammar-only", { input: "value" }, "then", { input: "body" }] } },
    { id: "test.action.summon", variantId: "test.action.summon", name: "summon", aliases: [], category: "test", namespace: "test", description: "summon", syntax: "summon <text>", flow: "normal", shape: "command", inputs: [{ name: "实体类型", key: "entityType", type: "text", accepts: ["text"], required: true, default: "ZOMBIE", options: ["ZOMBIE", "SKELETON"] }], output: null },
  ],
  selectors: [], triggers: [], properties: [],
})

describe("BlockDocument", () => {
  it("把嵌套 reporter 保存为 block reference，并保留局部 raw/comment", () => {
    const source = ["# before", "use report 3", "check one == two", "use 4"].join("\n")
    const document = parseBlockDocument(source, schema)
    const useBlock = Object.values(document.blocks).find((block) => block.opcode === "use" && block.inputs.value?.kind === "block")
    expect(useBlock?.inputs.value).toEqual(expect.objectContaining({ kind: "block" }))
    expect(Object.values(document.blocks).some((block) => block.kind === "raw" && String(block.source).includes("before"))).toBe(true)
    expect(Object.values(document.blocks).some((block) => block.kind === "predicate" && block.opcode === "check")).toBe(true)
    expect(serializeBlockDocument(document, schema)).toContain("check one == two")
  })

  it("序列化顺序只读取 roots/order，不读取坐标或 edge", () => {
    const document = parseBlockDocument("use 1\nuse 2", schema)
    const reversed = reorderDocumentBlocks(document, null, [...document.roots].reverse())
    expect(serializeBlockDocument(reversed, schema)).toBe("use 2\nuse 1")
  })

  it("docking 使用类型格与 ketherFillable 策略", () => {
    const source = parseBlockDocument("report 1", schema)
    const reporter = source.blocks[source.roots[0]]
    const numberInput = schema.actions[1].inputs[0]
    expect(canDockBlock(schema, reporter, numberInput).accepted).toBe(true)
    expect(canDockBlock(schema, reporter, { ...numberInput, type: "location", accepts: ["location"] })).toEqual(expect.objectContaining({ accepted: false }))
  })

  it("将 case、匿名块和嵌套谓词建模为容器/表达式块", () => {
    const source = "case report 1 [ when 1 -> use 2 else use 3 ]\nsync { use 4 }"
    const document = parseBlockDocument(source, schema)
    const caseBlock = Object.values(document.blocks).find((block) => block.opcode === "case")
    expect(caseBlock?.kind).toBe("container")
    expect(caseBlock?.inputs.value?.kind).toBe("block")
    expect(Object.values(document.blocks).some((block) => block.opcode === "sync" && block.kind === "container")).toBe(true)
    expect(serializeBlockDocument(document, schema)).toContain("case report 1")
  })

  it("ListNode 可作为 raw input 保存且 BlockDocument 公开结构不变", () => {
    const document = parseBlockDocument("use [ \"a\" \"b\" ]", schema)
    const block = document.blocks[document.roots[0]]
    expect(document).toEqual(expect.objectContaining({ version: 1, roots: expect.any(Array), blocks: expect.any(Object) }))
    expect(block?.inputs.value).toEqual(expect.objectContaining({ kind: "raw", source: "[ \"a\" \"b\" ]" }))
    expect(serializeBlockDocument(document, schema)).toBe("use [ \"a\" \"b\" ]")
  })

  it("localRawRemainder 整段保真，不拆成多个碎片块", () => {
    const source = "opaque alpha [ beta ]\nuse 1"
    const document = parseBlockDocument(source, schema)
    const rawBlocks = Object.values(document.blocks).filter((block) => block.kind === "raw" && block.source?.startsWith("opaque"))
    expect(rawBlocks).toHaveLength(1)
    expect(rawBlocks[0]?.source).toBe("opaque alpha [ beta ]")
    expect(serializeBlockDocument(document, schema)).toBe(source)
  })

  it("按 Schema 顺序保存前置关键字、位置参数与后置关键字，不静默重排或丢参", () => {
    const source = "buff send 石更 200\nbuff send 超级石更 they @self"
    const document = parseBlockDocument(source, schema)
    expect(serializeBlockDocument(document, schema)).toBe('buff send "石更" 200\nbuff send "超级石更" they @self')
  })

  it("枚举 literal 与 Raw Kether 表达式往返时均不丢值", () => {
    const literal = parseBlockDocument("summon ZOMBIE", schema)
    const literalBlock = literal.blocks[literal.roots[0]]
    expect(literalBlock?.inputs.entityType).toEqual(expect.objectContaining({ kind: "literal", value: "ZOMBIE" }))
    expect(serializeBlockDocument(literal, schema)).toBe('summon "ZOMBIE"')

    const raw = parseBlockDocument("summon &entityType", schema)
    const rawBlock = raw.blocks[raw.roots[0]]
    expect(rawBlock?.inputs.entityType).toEqual(expect.objectContaining({ kind: "raw", source: "&entityType" }))
    expect(serializeBlockDocument(raw, schema)).toBe("summon &entityType")
  })

  it("grammar 参数无法映射到公开输入时整段 raw，禁止保存时静默丢参", () => {
    const source = "grammar-only alpha then { use 1 }"
    const document = parseBlockDocument(source, schema)
    const block = document.blocks[document.roots[0]]
    expect(block).toEqual(expect.objectContaining({ kind: "raw", source }))
    expect(serializeBlockDocument(document, schema)).toBe(source)
  })
})
