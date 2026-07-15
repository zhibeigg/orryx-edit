import {
  Document,
  Scalar,
  isMap,
  isScalar,
  parseDocument,
  stringify,
  type YAMLMap,
} from "yaml"
import type { SkillData } from "@/types"

export class YamlSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "YamlSafetyError"
  }
}

export type SafeYamlResult<T> =
  | { ok: true; data: T; document: Document }
  | { ok: false; error: string }

export type YamlPathMutation =
  | { type: "set"; path: string[]; value: unknown }
  | { type: "delete"; path: string[] }
  | { type: "rename"; path: string[]; newKey: string }

/**
 * 安全解析 YAML 根对象。
 * 语法错误、空文档、null、数组或标量根节点都会返回明确错误，调用方不得据此生成回退 YAML。
 */
export function safeParseYaml<T = Record<string, unknown>>(content: string): SafeYamlResult<T> {
  try {
    const document = parseYamlDocument(content)
    return { ok: true, data: document.toJSON() as T, document }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "YAML 解析失败",
    }
  }
}

/** 解析并验证可被结构化编辑器安全修改的 YAML Document。 */
export function parseYamlDocument(content: string): Document {
  if (content.trim() === "") {
    throw new YamlSafetyError("YAML 文档为空，请先在源码模式中添加根对象。")
  }

  const document = parseDocument(content)
  if (document.errors.length > 0) {
    const details = document.errors.map((error) => error.message).join("；")
    throw new YamlSafetyError(`YAML 语法错误：${details}`)
  }
  if (document.contents === null) {
    throw new YamlSafetyError("YAML 文档为空，请先在源码模式中添加根对象。")
  }
  if (!isMap(document.contents)) {
    throw new YamlSafetyError("YAML 根节点必须是对象（键值映射），不能是数组或标量。")
  }
  return document
}

/** 解析 YAML 字符串为根对象；失败时抛出 YamlSafetyError。 */
export function parseYaml<T = Record<string, unknown>>(content: string): T {
  return parseYamlDocument(content).toJSON() as T
}

/**
 * 将 JS 对象序列化为 YAML 字符串。
 * 仅用于从零创建新文档，不应作为无效 YAML 的更新回退。
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

/** 对已验证文档执行路径级 mutation，并保留未修改节点、注释与标量样式。 */
export function updateYamlPaths(originalYaml: string, mutations: YamlPathMutation[]): string {
  const document = parseYamlDocument(originalYaml)

  for (const mutation of mutations) {
    if (mutation.type === "delete") {
      document.deleteIn(mutation.path)
      continue
    }
    if (mutation.type === "rename") {
      renameMapKey(document, mutation.path, mutation.newKey)
      continue
    }
    setDocumentValue(document, mutation.path, mutation.value)
  }

  return document.toString({ lineWidth: 0 })
}

/** 保留注释和格式的单字段路径更新。 */
export function updateYamlField(originalYaml: string, path: string[], value: unknown): string {
  return updateYamlPaths(originalYaml, [{ type: "set", path, value }])
}

/** 保留注释和格式的路径删除。 */
export function deleteYamlField(originalYaml: string, path: string[]): string {
  return updateYamlPaths(originalYaml, [{ type: "delete", path }])
}

/** 保留值节点、未知字段与注释的映射键重命名。 */
export function renameYamlField(originalYaml: string, path: string[], newKey: string): string {
  return updateYamlPaths(originalYaml, [{ type: "rename", path, newKey }])
}

/**
 * 保留注释的对象差异更新。
 * 原 YAML 无效时会抛出 YamlSafetyError，绝不会 stringify 新对象覆盖源码。
 */
export function updateYamlFromObject(originalYaml: string, newData: Record<string, unknown>): string {
  const document = parseYamlDocument(originalYaml)
  const original = document.toJSON() as Record<string, unknown>

  function deepUpdate(basePath: string[], oldObj: Record<string, unknown>, newObj: Record<string, unknown>) {
    for (const key of Object.keys(newObj)) {
      const newVal = newObj[key]
      const oldVal = oldObj[key]
      const currentPath = [...basePath, key]

      if (newVal === oldVal) continue
      if (newVal === undefined) {
        document.deleteIn(currentPath)
        continue
      }

      if (isPlainObject(newVal) && isPlainObject(oldVal)) {
        deepUpdate(currentPath, oldVal, newVal)
      } else {
        setDocumentValue(document, currentPath, newVal)
      }
    }

    for (const key of Object.keys(oldObj)) {
      if (!(key in newObj)) document.deleteIn([...basePath, key])
    }
  }

  deepUpdate([], original, newData)
  return document.toString({ lineWidth: 0 })
}

export function parseSkillYaml(content: string): SkillData {
  return parseYaml<SkillData>(content)
}

export function stringifySkillYaml(skill: SkillData): string {
  return stringifyYaml(skill)
}

function setDocumentValue(document: Document, path: string[], value: unknown) {
  if (typeof value === "string" && needsScalarStyle(value)) {
    document.setIn(path, createStyledScalar(value))
  } else {
    document.setIn(path, value)
  }
}

function renameMapKey(document: Document, path: string[], newKey: string) {
  if (path.length === 0) throw new YamlSafetyError("无法重命名 YAML 根节点。")
  const oldKey = path[path.length - 1]
  const parentPath = path.slice(0, -1)
  const parent = parentPath.length === 0 ? document.contents : document.getIn(parentPath, true)
  if (!isMap(parent)) throw new YamlSafetyError(`无法重命名 ${path.join(".")}：父节点不是对象。`)
  if (parent.has(newKey) && newKey !== oldKey) throw new YamlSafetyError(`键名 ${newKey} 已存在。`)

  const pair = (parent as YAMLMap).items.find((item) => {
    const key = item.key
    return isScalar(key) ? String(key.value) === oldKey : String(key) === oldKey
  })
  if (!pair) throw new YamlSafetyError(`找不到要重命名的键：${path.join(".")}`)

  if (isScalar(pair.key)) pair.key.value = newKey
  else pair.key = document.createNode(newKey)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function needsScalarStyle(value: string): boolean {
  return value.includes("\n") || value.includes("#") || value.includes('"')
}

function createStyledScalar(value: string): Scalar {
  const scalar = new Scalar(value)
  if (value.includes("\n")) scalar.type = Scalar.BLOCK_LITERAL
  else if (value.includes('"')) scalar.type = Scalar.QUOTE_SINGLE
  else scalar.type = Scalar.QUOTE_DOUBLE
  return scalar
}
