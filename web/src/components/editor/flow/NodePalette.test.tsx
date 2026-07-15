import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ActionsSchemaV2 } from "@/types/schema"
import { TooltipProvider } from "@/components/ui/tooltip"
import { NodePalette, PaletteItem } from "./NodePalette"

const schema: ActionsSchemaV2 = {
  version: 2,
  schemaVersion: 4,
  types: {
    any: { widget: "text", color: "#cccccc", ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  },
  categories: {
    logic: { color: "#42A5F5", icon: "logic" },
    "custom-addon": { color: "#ff00ff", icon: "puzzle" },
  },
  actions: [
    {
      id: "test.action.logic",
      variantId: "test.action.logic",
      name: "check",
      aliases: ["verify"],
      category: "logic",
      namespace: "test",
      description: "检查条件",
      syntax: "check <value>",
      inputs: [],
      output: null,
      flow: "normal",
      shape: "command",
    },
    {
      id: "test.action.custom",
      variantId: "test.action.custom",
      name: "custom",
      aliases: [],
      category: "custom-addon",
      namespace: "test",
      description: "扩展节点",
      syntax: "custom",
      inputs: [],
      output: null,
      flow: "normal",
      shape: "command",
    },
  ],
  selectors: [],
  triggers: [],
  properties: [],
}

describe("NodePalette", () => {
  it("使用中文分类标题，同时保留原始分类 ID 作为提示", () => {
    const markup = renderToStaticMarkup(<NodePalette schema={schema} onDragStart={() => undefined} />)

    expect(markup).toContain("控制流")
    expect(markup).toContain("逻辑")
    expect(markup).toContain("其他 · custom-addon")
    expect(markup).toContain("原始分类：logic")
    expect(markup).toContain("var(--ke-symbol-teal)")
  })

  it("节点项可通过键盘聚焦并暴露简介与语法", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <PaletteItem
          label="check"
          meta="value"
          description="检查条件"
          syntax="check <value>"
          color="#42A5F5"
          dragValue={schema.actions[0]}
          onDragStart={() => undefined}
        />
      </TooltipProvider>,
    )

    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain("check：检查条件。语法：check &lt;value&gt;")
    expect(markup).not.toContain('title="检查条件')
  })

  it("空白简介使用防御性回退", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <PaletteItem
          label="unknown"
          meta="unknown"
          description="   "
          color="#cccccc"
          dragValue={{ builtin: "unknown" }}
          onDragStart={() => undefined}
        />
      </TooltipProvider>,
    )

    expect(markup).toContain("unknown：此节点暂未提供简介。标识：unknown")
  })
})
