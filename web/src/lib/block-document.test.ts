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
    boolean: { widget: "toggle", color: "#fff", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
    location: { widget: "location", color: "#fff", extends: ["any"], ketherFillable: false, inputStrategy: "raw", serialization: "raw" },
  },
  categories: { test: { color: "#fff", icon: "test" } },
  actions: [
    { id: "test.action.report", variantId: "test.action.report", name: "report", aliases: [], category: "test", namespace: "test", description: "report", syntax: "report <number>", flow: "normal", shape: "reporter", inputs: [{ name: "value", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }], output: { type: "number" } },
    { id: "test.action.use", variantId: "test.action.use", name: "use", aliases: [], category: "test", namespace: "test", description: "use", syntax: "use <number>", flow: "normal", shape: "command", inputs: [{ name: "value", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }], output: null },
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
})
