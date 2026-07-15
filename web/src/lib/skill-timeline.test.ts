import { describe, expect, it } from "vitest"
import { parseTimeline } from "./skill-timeline"

describe("技能时间轴选择器", () => {
  it("复用统一解析器并保留完整圆柱参数", () => {
    const events = parseTimeline(`
      sleep 20
      damage 10 false they "@cyl 5 10 3 -1 true !@self"
    `)
    const damage = events.find((event) => event.type === "damage")

    expect(damage).toMatchObject({
      tick: 20,
      selector: {
        type: "cylinder",
        params: [5, 10, 3, -1, true],
      },
    })
  })

  it("launch 和 flash 仅记录动作，不改变后续选择器原点", () => {
    const events = parseTimeline(`
      launch 3 0 0 false
      flash 2 1 0
      damage 10 false they "@obb 12 4 5 -3 -1"
    `)
    const launch = events.find((event) => event.type === "launch")
    const damage = events.find((event) => event.type === "damage")

    expect(launch?.label).toContain("速度")
    expect(damage?.selector).toEqual({
      type: "obb",
      params: [12, 4, 5, -3, -1, false],
      label: "矩形 12×4×5",
    })
  })
})
