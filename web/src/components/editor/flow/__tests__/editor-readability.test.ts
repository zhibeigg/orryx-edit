import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { NODE_PORT_SIZE_PX } from "../nodes/node-interaction"

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), "utf8")
const css = source("../flow-editor.css")

function declaration(selector: string, property: string): string {
  const ruleStart = css.indexOf(`${selector} {`)
  expect(ruleStart, `缺少 ${selector} 样式`).toBeGreaterThanOrEqual(0)
  const bodyStart = css.indexOf("{", ruleStart) + 1
  const bodyEnd = css.indexOf("}", bodyStart)
  const body = css.slice(bodyStart, bodyEnd)
  const propertyStart = body.indexOf(`${property}:`)
  expect(propertyStart, `缺少 ${selector} 的 ${property}`).toBeGreaterThanOrEqual(0)
  const valueStart = propertyStart + property.length + 1
  const valueEnd = body.indexOf(";", valueStart)
  return body.slice(valueStart, valueEnd).trim()
}

function toPixels(value: string): number {
  const variable = /^var\((--[^)]+)\)$/.exec(value)
  if (variable) return toPixels(declaration(".kether-editor", variable[1]))
  if (value.endsWith("rem")) return Number.parseFloat(value) * 16
  if (value.endsWith("px")) return Number.parseFloat(value)
  throw new Error(`无法解析 CSS 长度：${value}`)
}

describe("Kether 编辑器舒适可读尺寸", () => {
  it("维持约 20% 放大的字号与约 25% 放大的控件节奏", () => {
    expect(toPixels(declaration(".kether-editor", "--ke-text-caption"))).toBeGreaterThanOrEqual(12)
    expect(toPixels(declaration(".kether-editor", "--ke-text-meta"))).toBeGreaterThanOrEqual(13)
    expect(toPixels(declaration(".kether-editor", "--ke-text-body"))).toBeGreaterThanOrEqual(14)
    expect(toPixels(declaration(".kether-editor", "--ke-control-sm"))).toBeGreaterThanOrEqual(32)
    expect(toPixels(declaration(".kether-editor", "--ke-control-md"))).toBeGreaterThanOrEqual(36)
  })

  it("节点库、拼图节点与输入槽不会回退到紧凑旧尺寸", () => {
    expect(toPixels(declaration(".kether-palette", "width"))).toBeGreaterThanOrEqual(280)
    expect(toPixels(declaration(".kether-block", "width"))).toBeGreaterThanOrEqual(380)
    expect(toPixels(declaration(".kether-editor__modebar", "min-height"))).toBeGreaterThanOrEqual(44)
    expect(toPixels(declaration(".scratch-block__header", "min-height"))).toBeGreaterThanOrEqual(40)
    expect(toPixels(declaration(".scratch-input-slot", "min-height"))).toBeGreaterThanOrEqual(40)
    expect(toPixels(declaration(".kether-editor .react-flow__controls-button", "width"))).toBeGreaterThanOrEqual(36)
  })

  it("Flow 节点不再使用 10px 及以下文字，并保留清晰端口", () => {
    const nodeSource = ["ActionNode.tsx", "BranchNode.tsx", "LoopNode.tsx", "DataNode.tsx", "CalcNode.tsx", "SetNode.tsx"]
      .map((file) => source(`../nodes/${file}`))
      .join("\n")

    expect(nodeSource).not.toMatch(/text-\[(?:[0-9]|10)px\]/)
    expect(NODE_PORT_SIZE_PX).toBeGreaterThanOrEqual(14)
  })
})
