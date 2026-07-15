import { describe, expect, it } from "vitest"
import type { FileTreeNode } from "@/types"
import { buildJobSkillTargetIndex, resolveJobSkillTarget } from "./job-skill-targets"

function directory(name: string, path: string, children: FileTreeNode[]): FileTreeNode {
  return { name, path, isDirectory: true, children }
}

function file(path: string): FileTreeNode {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    isDirectory: false,
  }
}

describe("职业技能配置目标索引", () => {
  it("收集 skills 根目录与多层目录中的 yml 文件", () => {
    const index = buildJobSkillTargetIndex([
      directory("skills", "skills", [
        file("skills/玄珠.yml"),
        directory("御修", "skills/御修", [
          file("skills/御修/玄天护体诀.yml"),
          directory("进阶", "skills/御修/进阶", [file("skills/御修/玄光引渡.yml")]),
        ]),
      ]),
    ])

    expect(Array.from(index.keys())).toEqual(["玄光引渡", "玄天护体诀", "玄珠"])
    expect(resolveJobSkillTarget("玄天护体诀", index)).toEqual({
      status: "found",
      target: { name: "玄天护体诀", path: "skills/御修/玄天护体诀.yml" },
    })
  })

  it("忽略技能目录之外、目录节点和非 yml 文件", () => {
    const index = buildJobSkillTargetIndex([
      directory("skills", "skills", [
        directory("目录.yml", "skills/目录.yml", []),
        file("skills/readme.txt"),
        file("skills/大写.YML"),
      ]),
      directory("jobs", "jobs", [file("jobs/玄修.yml")]),
    ])

    expect(index.size).toBe(0)
  })

  it("规范化 Windows 分隔符并去重同一路径", () => {
    const duplicate = file("skills\\御修\\玄珠.yml")
    const index = buildJobSkillTargetIndex([duplicate, duplicate])

    expect(resolveJobSkillTarget("玄珠", index)).toEqual({
      status: "found",
      target: { name: "玄珠", path: "skills/御修/玄珠.yml" },
    })
  })

  it("同名文件返回全部候选而不随机选择", () => {
    const index = buildJobSkillTargetIndex([
      file("skills/御修/玄珠.yml"),
      file("skills/散修/玄珠.yml"),
    ])

    expect(resolveJobSkillTarget("玄珠", index)).toEqual({
      status: "ambiguous",
      targets: [
        { name: "玄珠", path: "skills/散修/玄珠.yml" },
        { name: "玄珠", path: "skills/御修/玄珠.yml" },
      ],
    })
  })

  it("名称或大小写不匹配时明确返回缺失", () => {
    const index = buildJobSkillTargetIndex([file("skills/Fireball.yml")])

    expect(resolveJobSkillTarget("fireball", index)).toEqual({ status: "missing" })
    expect(resolveJobSkillTarget("不存在", index)).toEqual({ status: "missing" })
  })
})
