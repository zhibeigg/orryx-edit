import { describe, expect, it } from "vitest"
import { parseYaml, safeParseYaml, updateYamlFromObject, updateYamlPaths, YamlSafetyError } from "../yaml-parser"

describe("safeParseYaml", () => {
  it("拒绝带解析错误的 YAML", () => {
    const result = safeParseYaml("Options:\n  Name: [broken\n")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("YAML 语法错误")
  })

  it.each([
    ["", "YAML 文档为空"],
    ["null\n", "YAML 根节点必须是对象"],
    ["- one\n- two\n", "YAML 根节点必须是对象"],
    ["plain scalar\n", "YAML 根节点必须是对象"],
  ])("拒绝不安全根文档 %#", (source, message) => {
    const result = safeParseYaml(source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })

  it("无效 YAML 更新不会 stringify 回退覆盖源码", () => {
    const source = "Options:\n  Name: [broken\n"
    expect(() => updateYamlFromObject(source, { Options: { Name: "replacement" } })).toThrow(YamlSafetyError)
  })
})

describe("updateYamlPaths", () => {
  it("字段更新保留未知字段、注释和多行标量", () => {
    const source = [
      "# root comment",
      "npc:",
      "  name: old # inline comment",
      "  unknown-field: keep-me",
      "  system: |",
      "    first line",
      "    second line",
      "other:",
      "  enabled: true",
      "",
    ].join("\n")

    const updated = updateYamlPaths(source, [{ type: "set", path: ["npc", "name"], value: "new" }])

    expect(updated).toContain("# root comment")
    expect(updated).toContain("# inline comment")
    expect(updated).toContain("unknown-field: keep-me")
    expect(updated).toContain("system: |")
    expect(updated).toContain("first line\n    second line")
    expect(updated).toContain("other:\n  enabled: true")
    expect(parseYaml<Record<string, { name: string }>>(updated).npc.name).toBe("new")
  })

  it("映射键重命名保留整棵值节点中的未知字段", () => {
    const source = "old-key:\n  known: 1\n  unknown: keep # note\n"
    const updated = updateYamlPaths(source, [{ type: "rename", path: ["old-key"], newKey: "new-key" }])

    expect(updated).toContain("new-key:")
    expect(updated).toContain("unknown: keep # note")
    expect(updated).not.toContain("old-key:")
  })
})
