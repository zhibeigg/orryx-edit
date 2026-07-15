import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { mergeSchemas, normalizeSchema, toParserActionsSchema } from "@/types/schema"
import {
  parseKether,
  stringifyKether,
  type ActionsSchema,
  type ASTNode,
  type ListNode,
} from "../kether-ast"

const orryxSchemaPath = resolve(__dirname, "../../../../schemas/actions-schema.json")
const taboolibSchemaPath = resolve(__dirname, "../../../../schemas/taboolib-6.3.0/actions-schema.json")
const orryxSchema = normalizeSchema(JSON.parse(readFileSync(orryxSchemaPath, "utf-8")))
const taboolibSchema = normalizeSchema(JSON.parse(readFileSync(taboolibSchemaPath, "utf-8")))
const productionParserSchema = toParserActionsSchema(mergeSchemas(orryxSchema, taboolibSchema))

const parserSchema: ActionsSchema = {
  actions: [
    {
      id: "test.action.maybe",
      variantId: "test.action.maybe.default",
      name: "maybe",
      params: [],
      grammar: {
        sequence: [
          "maybe",
          { input: "value" },
          { optional: ["else", { input: "fallback" }] },
        ],
      },
    },
    {
      id: "test.action.broken",
      name: "broken",
      params: [],
      grammar: { sequence: ["broken", "then", { input: "value" }] },
    },
    {
      id: "test.action.opaque",
      name: "opaque",
      params: [{ name: "arguments", type: "raw", optional: true }],
      grammar: { localRawRemainder: true },
      shape: "raw",
    },
    {
      id: "test.action.inner-when",
      variantId: "test.action.inner-when.default",
      name: "when",
      namespace: "kether_inner:when",
      params: [],
    },
    {
      id: "test.action.buff-send",
      variantId: "test.action.buff-send.default",
      name: "buff",
      params: [
        { name: "发送标识符", type: "keyword", optional: false, keyword: "send" },
        { name: "buff 名", type: "text", optional: false },
        { name: "持续时长", type: "long", optional: true },
        { name: "目标容器", type: "container", optional: true, keyword: "they" },
      ],
    },
    {
      id: "test.action.ping",
      variantId: "test.action.ping.default",
      name: "ping",
      namespace: "demo",
      params: [],
    },
  ],
}

function withoutPositions(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, nested) => (
    key === "start" || key === "end" || key === "reason" ? undefined : nested
  )))
}

function descendants(node: ASTNode): ASTNode[] {
  const result: ASTNode[] = [node]
  switch (node.type) {
    case "script": node.body.forEach((child) => result.push(...descendants(child))); break
    case "action_call": {
      node.args.forEach((child) => result.push(...descendants(child)))
      Object.values(node.keywordArgs).forEach((child) => result.push(...descendants(child)))
      break
    }
    case "set": result.push(...descendants(node.value)); break
    case "if": {
      result.push(...descendants(node.condition))
      node.thenBody.forEach((child) => result.push(...descendants(child)))
      node.elseIfClauses.forEach((clause) => {
        result.push(...descendants(clause.condition))
        clause.body.forEach((child) => result.push(...descendants(child)))
      })
      node.elseBody?.forEach((child) => result.push(...descendants(child)))
      break
    }
    case "for": {
      result.push(...descendants(node.iterable))
      node.body.forEach((child) => result.push(...descendants(child)))
      break
    }
    case "case": {
      result.push(...descendants(node.expr))
      node.whenClauses.forEach((clause) => {
        result.push(...descendants(clause.value), ...descendants(clause.body))
      })
      if (node.elseClause) result.push(...descendants(node.elseClause))
      break
    }
    case "block": node.body.forEach((child) => result.push(...descendants(child))); break
    case "list": node.items.forEach((child) => result.push(...descendants(child))); break
    case "check": result.push(...descendants(node.left), ...descendants(node.right)); break
    case "logic": node.conditions.forEach((child) => result.push(...descendants(child))); break
    case "math": node.operands.forEach((child) => result.push(...descendants(child))); break
    case "lazy": result.push(...descendants(node.expr)); break
    case "flag": {
      result.push(...descendants(node.name))
      if (node.value) result.push(...descendants(node.value))
      if (node.timeout) result.push(...descendants(node.timeout))
      break
    }
    default: break
  }
  return result
}

describe("Kether AST TabooLib cursor semantics", () => {
  it("覆盖截图回归：if/all/check 与 array/for 都完整消费结构括号", () => {
    const source = [
      "if all [ check &event[key] == true ] then { exit }",
      "for i in array [ \"a\" \"b\" ] then { set l to &i }",
    ].join("\n")
    const ast = parseKether(source, productionParserSchema)

    expect(ast.body.map((node) => node.type)).toEqual(["if", "for"])
    expect(descendants(ast).filter((node) => node.type === "raw")).toEqual([])
    expect(descendants(ast).some((node) => node.type === "var_ref" && node.name === "event" && node.key === "key")).toBe(true)
    expect(descendants(ast).filter((node) => node.type === "list")).toHaveLength(1)
    expect(stringifyKether(ast)).not.toMatch(/^\s*\]\s*$/m)
  })

  it("生产 Schema 的可选位置参数不会跨行吞掉下一条 action", () => {
    const ast = parseKether('player health\ntell "next"', productionParserSchema)
    expect(ast.body).toHaveLength(2)
    expect(ast.body[0]).toEqual(expect.objectContaining({ type: "action_call", name: "player" }))
    expect(ast.body[1]).toEqual(expect.objectContaining({ type: "action_call", name: "tell" }))
  })

  it("保留关键字与位置参数顺序，且可选位置参数不会吞掉后续关键字", () => {
    const source = [
      "buff send 石更 200",
      "buff send 超级石更 they @self",
    ].join("\n")
    const ast = parseKether(source, parserSchema)

    expect(ast.body).toHaveLength(2)
    expect(ast.body[1]).toEqual(expect.objectContaining({
      type: "action_call",
      args: [expect.objectContaining({ type: "identifier", name: "超级石更" })],
      keywordArgs: expect.objectContaining({ send: expect.any(Object), they: expect.objectContaining({ type: "identifier", name: "@self" }) }),
    }))
    expect(stringifyKether(ast)).toBe(source)
  })

  it("支持递归 action list、匿名块、引号内括号、重复双引号、单引号与 \\s", () => {
    const source = "seq [ array [ \"\"\"left [ \"quoted\" ]\"\"\" 'right { value }' hello\\sworld ] { exit } ]"
    const ast = parseKether(source, parserSchema)
    const root = ast.body[0]

    expect(root?.type).toBe("action_call")
    const outerList = root?.type === "action_call" ? root.args[0] as ListNode : null
    expect(outerList?.type).toBe("list")
    expect(outerList?.items[0]?.type).toBe("action_call")
    expect(outerList?.items[1]?.type).toBe("block")
    const array = outerList?.items[0]
    const innerList = array?.type === "action_call" ? array.args[0] as ListNode : null
    expect(innerList?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "string", value: 'left [ "quoted" ]' }),
      expect.objectContaining({ type: "string", value: "right { value }" }),
      expect.objectContaining({ type: "identifier", name: "hello world" }),
    ]))

    const serialized = stringifyKether(ast)
    expect(withoutPositions(parseKether(serialized, parserSchema))).toEqual(withoutPositions(ast))
  })

  it("optional grammar 失败会回滚，不会吞掉下一行 action 或注释边界", () => {
    const source = "maybe true // keep this comment\nexit"
    const ast = parseKether(source, parserSchema)

    expect(ast.body).toHaveLength(2)
    expect(ast.body[0]).toEqual(expect.objectContaining({ type: "action_call", name: "maybe", args: [expect.objectContaining({ type: "boolean", value: true })] }))
    expect(ast.body[1]).toEqual(expect.objectContaining({ type: "action_call", name: "exit" }))
  })

  it("kether_inner action 不污染顶层名称空间，普通 namespace 支持显式限定名", () => {
    const ast = parseKether("when\ndemo:ping", parserSchema)
    expect(ast.body).toEqual([
      expect.objectContaining({ type: "raw", raw: "when" }),
      expect.objectContaining({ type: "action_call", name: "demo:ping", variantId: "test.action.ping.default" }),
    ])
  })

  it("required expect 失败与 localRawRemainder 都按整个局部 action 回退 raw", () => {
    const required = parseKether("broken nope\nexit", parserSchema)
    expect(required.body).toEqual([
      expect.objectContaining({ type: "raw", raw: "broken nope" }),
      expect.objectContaining({ type: "action_call", name: "exit" }),
    ])

    const localRaw = parseKether("opaque alpha [ beta ]\nexit", parserSchema)
    expect(localRaw.body).toEqual([
      expect.objectContaining({ type: "raw", raw: "opaque alpha [ beta ]" }),
      expect.objectContaining({ type: "action_call", name: "exit" }),
    ])
  })

  it("按真实 case/when/else 语义解析条件列表、比较符与 action body", () => {
    const source = "case &event[key] [ when [ \"a\" \"b\" ] -> exit when != \"c\" then { exit } else exit ]"
    const ast = parseKether(source, parserSchema)
    const node = ast.body[0]

    expect(node?.type).toBe("case")
    if (node?.type !== "case") return
    expect(node.expr).toEqual(expect.objectContaining({ type: "var_ref", name: "event", key: "key" }))
    expect(node.whenClauses[0]?.value.type).toBe("list")
    expect(node.whenClauses[1]?.operator).toBe("!=")
    expect(node.whenClauses[1]?.body.type).toBe("block")
    expect(node.elseClause?.type).toBe("action_call")
  })

  it("parse→serialize→parse 对结构化脚本保持稳定", () => {
    const source = [
      "if all [ check &event[key] == true ] then { seq [ exit { exit } ] } else exit",
      "for i in array [ \"a\" 'b' ] then { set l to &i }",
      "case &i [ when == \"a\" -> exit else { exit } ]",
    ].join("\n")
    const first = parseKether(source, parserSchema)
    const second = parseKether(stringifyKether(first), parserSchema)
    expect(withoutPositions(second)).toEqual(withoutPositions(first))
  })
})
