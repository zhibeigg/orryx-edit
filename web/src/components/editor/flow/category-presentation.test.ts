import { describe, expect, it } from "vitest"
import {
  getKetherBuiltinColor,
  getKetherCategoryPresentation,
  matchesKetherCategoryQuery,
  normalizeKetherCategoryId,
} from "./category-presentation"

describe("Kether 分类展示", () => {
  it.each([
    ["core", "核心"],
    ["player", "玩家"],
    ["platform", "平台"],
    ["flow", "流程"],
    ["data", "数据"],
    ["output", "输出"],
    ["logic", "逻辑"],
    ["variable", "变量"],
    ["loop", "循环"],
    ["math", "数学"],
    ["game", "游戏"],
    ["time", "时间"],
    ["combat", "战斗"],
    ["entity", "实体"],
    ["compat", "兼容"],
    ["misc", "其他"],
    ["particle", "粒子"],
    ["movement", "移动"],
    ["selector", "选择器"],
    ["sound", "音效"],
    ["world", "世界"],
  ])("将 %s 显示为中文分类 %s", (category, label) => {
    expect(getKetherCategoryPresentation(category).label).toBe(label)
  })

  it("规范化分类 ID，并为未知分类保留技术名称", () => {
    expect(normalizeKetherCategoryId("  PLAYER ")).toBe("player")
    expect(getKetherCategoryPresentation("custom-addon").label).toBe("其他 · custom-addon")
  })

  it("分类搜索同时支持中文名与英文 ID", () => {
    expect(matchesKetherCategoryQuery("combat", "战斗")).toBe(true)
    expect(matchesKetherCategoryQuery("combat", "COMB")).toBe(true)
    expect(matchesKetherCategoryQuery("combat", "玩家")).toBe(false)
  })

  it("内置节点使用 VS Code 语义色变量", () => {
    expect(getKetherBuiltinColor("if")).toBe("var(--ke-symbol-teal)")
    expect(getKetherBuiltinColor("set")).toBe("var(--ke-symbol-yellow)")
    expect(getKetherBuiltinColor("raw")).toBe("var(--ke-symbol-coral)")
  })
})
