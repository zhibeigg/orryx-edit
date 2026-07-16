import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ActionsSchemaV2 } from "@/types/schema"
import { ScratchEditor } from "./ScratchEditor"

const schema: ActionsSchemaV2 = {
  version: 2,
  schemaVersion: 4,
  types: {
    any: { widget: "text", color: "#cccccc", extends: [], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
    number: { widget: "number", color: "#b5cea8", extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  },
  categories: {
    test: { color: "#569cd6", icon: "test" },
  },
  actions: [
    {
      id: "test.action.report",
      variantId: "test.action.report",
      name: "report",
      aliases: [],
      category: "test",
      namespace: "test",
      description: "返回数值",
      syntax: "report <number>",
      flow: "normal",
      shape: "reporter",
      inputs: [{ name: "数值", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }],
      output: { type: "number" },
    },
    {
      id: "test.action.use",
      variantId: "test.action.use",
      name: "use",
      aliases: [],
      category: "test",
      namespace: "test",
      description: "使用数值",
      syntax: "use <number>",
      flow: "normal",
      shape: "command",
      inputs: [{ name: "目标参数", key: "value", type: "number", accepts: ["number"], required: true, default: 0 }],
      output: null,
    },
  ],
  selectors: [],
  triggers: [],
  properties: [],
}

describe("ScratchEditor 嵌套布局", () => {
  it("把深层输入子块放到父 article 外侧的横向子轨道", () => {
    const markup = renderToStaticMarkup(
      <ScratchEditor value="use report report report report 3" onChange={() => undefined} schema={schema} />,
    )

    expect(markup.match(/class="scratch-block-tree"/g)).toHaveLength(5)
    expect(markup.match(/class="scratch-block-tree__children"/g)).toHaveLength(4)
    expect(markup.match(/<article class="scratch-block"/g)).toHaveLength(5)
    expect(markup.indexOf('class="scratch-block-tree__children"')).toBeGreaterThan(markup.indexOf("</article>"))
  })
})
