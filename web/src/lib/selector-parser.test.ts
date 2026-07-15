import { describe, expect, it } from "vitest"
import { parseAllSelectors, parseSelectorFromScript, parseSelectorsFromLine } from "./selector-parser"

describe("选择器脚本解析", () => {
  it("完整保留 OBB 的负偏移与 followPitch", () => {
    const [selector] = parseSelectorsFromLine('damage 10 false they "@obb 12 4 5 -3 -1 true !@self"')

    expect(selector).toEqual({
      type: "obb",
      params: [12, 4, 5, -3, -1, true],
      label: "矩形 12×4×5",
    })
  })

  it("支持服务端别名和完整可选参数", () => {
    const selectors = parseSelectorsFromLine("@sec 8 90 3 -2 @cyl 2 6 4 -1 true @look 20 7")

    expect(selectors.map((selector) => [selector.type, selector.params])).toEqual([
      ["sector", [8, 90, 3, -2]],
      ["cylinder", [2, 6, 4, -1, true]],
      ["lookat", [20, 7]],
    ])
  })

  it("省略可选参数时使用 Orryx 服务端默认值", () => {
    expect(parseSelectorsFromLine("@cone 5 10 !@self")[0].params).toEqual([5, 10, 0, 0, false])
    expect(parseSelectorsFromLine("@cylinder 5 10 3 !@self")[0].params).toEqual([5, 10, 3, 0, false])
    expect(parseSelectorFromScript("@range")?.params).toEqual([10])
  })

  it("位移动作不会被累计成后续选择器的静态原点偏移", () => {
    const [selector] = parseAllSelectors(`
      flash 3 2 1
      launch 1 0 0 false
      sleep 5
      damage 10 false they "@obb 12 4 5 -3 -1"
    `)

    expect(selector).toMatchObject({
      type: "obb",
      params: [12, 4, 5, -3, -1, false],
      tick: 5,
    })
    expect(selector).not.toHaveProperty("offset")
  })
})
