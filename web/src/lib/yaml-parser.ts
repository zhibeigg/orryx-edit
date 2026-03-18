import { parseDocument, stringify, Document, Scalar } from "yaml"
import type { SkillData } from "@/types"

/**
 * 解析 YAML 字符串为 JS 对象
 * 使用 yaml@2，支持保留注释的文档级操作
 */
export function parseYaml<T = Record<string, unknown>>(content: string): T {
  const doc = parseDocument(content)
  return doc.toJSON() as T
}

/**
 * 将 JS 对象序列化为 YAML 字符串
 * 用于从零生成 YAML（不保留原始格式）
 */
export function stringifyYaml(data: unknown): string {
  return stringify(data, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
    blockQuote: "literal",
  })
}

/**
 * 保留注释和格式的 YAML 字段更新
 * 解析原始 YAML 为 Document，修改指定路径的值，再序列化回字符串
 * 这样可以保留未修改部分的注释和格式
 */
export function updateYamlField(originalYaml: string, path: string[], value: unknown): string {
  const doc = parseDocument(originalYaml)
  if (typeof value === "string" && needsScalarStyle(value)) {
    doc.setIn(path, createStyledScalar(value))
  } else {
    doc.setIn(path, value)
  }
  return doc.toString({ lineWidth: 0 })
}

/**
 * 保留注释的批量字段更新
 * 接收原始 YAML 和一个新的 JS 对象，只更新变化的字段
 */
export function updateYamlFromObject(originalYaml: string, newData: Record<string, unknown>): string {
  const doc = parseDocument(originalYaml)
  const original = doc.toJSON() as Record<string, unknown>

  function deepUpdate(doc: Document, basePath: string[], oldObj: Record<string, unknown>, newObj: Record<string, unknown>) {
    // 处理新增和修改的键
    for (const key of Object.keys(newObj)) {
      const newVal = newObj[key]
      const oldVal = oldObj[key]
      const currentPath = [...basePath, key]

      if (newVal === oldVal) continue

      // undefined 值视为删除字段
      if (newVal === undefined) {
        doc.deleteIn(currentPath)
        continue
      }

      if (
        newVal !== null && typeof newVal === "object" && !Array.isArray(newVal) &&
        oldVal !== null && typeof oldVal === "object" && !Array.isArray(oldVal)
      ) {
        deepUpdate(doc, currentPath, oldVal as Record<string, unknown>, newVal as Record<string, unknown>)
      } else {
        // 多行字符串、含 # 或含双引号的字符串需要特殊处理
        if (typeof newVal === "string" && needsScalarStyle(newVal)) {
          doc.setIn(currentPath, createStyledScalar(newVal))
        } else {
          doc.setIn(currentPath, newVal)
        }
      }
    }

    // 处理删除的键
    for (const key of Object.keys(oldObj)) {
      if (!(key in newObj)) {
        doc.deleteIn([...basePath, key])
      }
    }
  }

  deepUpdate(doc, [], original, newData)
  return doc.toString({ lineWidth: 0 })
}

export function parseSkillYaml(content: string): SkillData {
  return parseYaml<SkillData>(content)
}

export function stringifySkillYaml(skill: SkillData): string {
  return stringifyYaml(skill)
}

/** 判断字符串是否需要特殊的 YAML 标量格式 */
function needsScalarStyle(value: string): boolean {
  return value.includes("\n") || value.includes("#") || value.includes('"')
}

/** 创建带样式的 YAML 标量节点 */
function createStyledScalar(value: string): Scalar {
  const scalar = new Scalar(value)
  if (value.includes("\n")) {
    // 多行 → 块标量
    scalar.type = Scalar.BLOCK_LITERAL
  } else if (value.includes('"')) {
    // 含双引号 → 单引号包裹
    scalar.type = Scalar.QUOTE_SINGLE
  } else {
    // 含 # → 双引号包裹
    scalar.type = Scalar.QUOTE_DOUBLE
  }
  return scalar
}
