import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EnumCombobox, EnumOptionsList } from "./EnumCombobox"

describe("EnumCombobox", () => {
  it("关闭状态暴露可搜索选择器语义与自定义值状态", () => {
    const markup = renderToStaticMarkup(
      <EnumCombobox
        label="实体类型"
        value="CUSTOM_BOSS"
        options={["ZOMBIE", "SKELETON"]}
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain('data-custom="true"')
    expect(markup).toContain("自定义")
  })

  it("结果列表使用 listbox/option 与 aria-selected", () => {
    const markup = renderToStaticMarkup(
      <EnumOptionsList
        id="entity-options"
        label="实体类型"
        options={["ZOMBIE", "SKELETON"]}
        value="ZOMBIE"
        activeIndex={1}
        onActiveIndexChange={() => undefined}
        onSelect={() => undefined}
        empty={false}
      />,
    )

    expect(markup).toContain('role="listbox"')
    expect(markup.match(/role="option"/g)).toHaveLength(2)
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('data-active="true"')
  })
})
