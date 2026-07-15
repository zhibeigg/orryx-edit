export type SelectorType =
  | "range" | "sector" | "obb" | "line" | "cone" | "cylinder"
  | "frustum" | "annular" | "nearest" | "lookat" | "location"
  | "vector" | "scatter" | "ring" | "floor" | "rayhit"

export type SelectorParamValue = number | boolean
export type SelectorParamKind = "number" | "integer" | "boolean"

export interface SelectorParamDefinition {
  key: string
  label: string
  kind: SelectorParamKind
  defaultValue: SelectorParamValue
  min?: number
  max?: number
  step?: number
}

export interface SelectorDefinition {
  type: SelectorType
  aliases: readonly string[]
  params: readonly SelectorParamDefinition[]
  label: (params: readonly SelectorParamValue[]) => string
}

export interface SelectorInfo {
  type: SelectorType
  params: SelectorParamValue[]
}

export interface ParsedSelector extends SelectorInfo {
  label: string
}

/** 带时间信息的选择器。 */
export interface TimedSelector extends ParsedSelector {
  tick: number
  raw: string
}

const numberParam = (
  key: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  step = 0.5,
): SelectorParamDefinition => ({ key, label, kind: "number", defaultValue, min, max, step })

const integerParam = (
  key: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
): SelectorParamDefinition => ({ key, label, kind: "integer", defaultValue, min, max, step: 1 })

const booleanParam = (key: string, label: string, defaultValue = false): SelectorParamDefinition => ({
  key,
  label,
  kind: "boolean",
  defaultValue,
})

function formatParam(value: SelectorParamValue): string {
  return typeof value === "boolean" ? String(value) : Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

export const SELECTOR_DEFINITIONS: Partial<Record<SelectorType, SelectorDefinition>> = {
  range: {
    type: "range",
    aliases: ["range"],
    params: [numberParam("radius", "半径 R", 10, 0, 64)],
    label: (params) => `球形 R=${formatParam(params[0])}`,
  },
  obb: {
    type: "obb",
    aliases: ["obb"],
    params: [
      numberParam("length", "长度 L", 0, 0, 64),
      numberParam("width", "宽度 W", 0, 0, 64),
      numberParam("height", "高度 H", 0, 0, 64),
      numberParam("forward", "前方偏移", 0, -32, 32),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
      booleanParam("followPitch", "跟随俯仰角"),
    ],
    label: (params) => `矩形 ${formatParam(params[0])}×${formatParam(params[1])}×${formatParam(params[2])}`,
  },
  sector: {
    type: "sector",
    aliases: ["sector", "sec"],
    params: [
      numberParam("radius", "半径 R", 10, 0, 64),
      numberParam("angle", "角度", 120, 0, 360, 5),
      numberParam("height", "高度 H", 2, 0, 64),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
    ],
    label: (params) => `扇形 R=${formatParam(params[0])} ${formatParam(params[1])}°`,
  },
  line: {
    type: "line",
    aliases: ["line"],
    params: [
      numberParam("length", "长度 L", 10, 0, 64),
      numberParam("width", "宽度 W", 1, 0, 64),
      numberParam("height", "高度 H", 2, 0, 64),
      booleanParam("followPitch", "跟随俯仰角"),
    ],
    label: (params) => `线形 ${formatParam(params[0])}×${formatParam(params[1])}×${formatParam(params[2])}`,
  },
  cone: {
    type: "cone",
    aliases: ["cone"],
    params: [
      numberParam("radius", "底部半径 R", 5, 0, 64),
      numberParam("length", "长度 L", 10, 0, 64),
      numberParam("yawOffset", "偏航角", 0, -180, 180, 5),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
      booleanParam("followPitch", "跟随俯仰角"),
    ],
    label: (params) => `锥形 R=${formatParam(params[0])} L=${formatParam(params[1])}`,
  },
  cylinder: {
    type: "cylinder",
    aliases: ["cylinder", "cyl"],
    params: [
      numberParam("radius", "半径 R", 5, 0, 64),
      numberParam("height", "轴向高度 H", 10, 0, 64),
      numberParam("forward", "前方偏移", 0, -32, 32),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
      booleanParam("followPitch", "跟随俯仰角"),
    ],
    label: (params) => `圆柱 R=${formatParam(params[0])} H=${formatParam(params[1])}`,
  },
  frustum: {
    type: "frustum",
    aliases: ["frustum"],
    params: [
      numberParam("topRadius", "近端半径", 1, 0, 64),
      numberParam("bottomRadius", "远端半径", 10, 0, 64),
      numberParam("length", "长度 L", 10, 0, 64),
      numberParam("yawOffset", "偏航角", 0, -180, 180, 5),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
      booleanParam("followPitch", "跟随俯仰角"),
    ],
    label: (params) => `截锥 ${formatParam(params[0])}→${formatParam(params[1])} L=${formatParam(params[2])}`,
  },
  annular: {
    type: "annular",
    aliases: ["annular"],
    params: [
      numberParam("minRadius", "最小半径", 0, 0, 64),
      numberParam("maxRadius", "最大半径", 0, 0, 64),
      numberParam("height", "高度 H", 0, 0, 64),
    ],
    label: (params) => `环形 ${formatParam(params[0])}~${formatParam(params[1])} H=${formatParam(params[2])}`,
  },
  nearest: {
    type: "nearest",
    aliases: ["nearest"],
    params: [
      integerParam("amount", "数量 N", 1, 1, 30),
      numberParam("radius", "搜索半径 R", 32, 0, 64),
    ],
    label: (params) => `最近 N=${formatParam(params[0])} R=${formatParam(params[1])}`,
  },
  lookat: {
    type: "lookat",
    aliases: ["lookat", "look"],
    params: [
      numberParam("distance", "最大距离", 32, 0, 64),
      numberParam("tolerance", "角度容差（半角）", 5, 0, 90, 1),
    ],
    label: (params) => `注视 D=${formatParam(params[0])} ±${formatParam(params[1])}°`,
  },
  scatter: {
    type: "scatter",
    aliases: ["scatter"],
    params: [
      integerParam("amount", "数量 N", 5, 1, 30),
      numberParam("radius", "半径 R", 10, 0, 64),
      numberParam("forward", "前方偏移", 0, -32, 32),
    ],
    label: (params) => `散射 N=${formatParam(params[0])} R=${formatParam(params[1])}`,
  },
  ring: {
    type: "ring",
    aliases: ["ring"],
    params: [
      numberParam("radius", "半径 R", 5, 0, 64),
      integerParam("amount", "数量 N", 8, 1, 30),
      numberParam("offsetY", "上方偏移", 0, -32, 32),
    ],
    label: (params) => `环阵 R=${formatParam(params[0])} N=${formatParam(params[1])}`,
  },
}

const definitionByAlias = new Map<string, SelectorDefinition>()
for (const definition of Object.values(SELECTOR_DEFINITIONS)) {
  if (!definition) continue
  for (const alias of definition.aliases) definitionByAlias.set(alias, definition)
}

const selectorTokenPattern = /(?:!@|@!|@)([A-Za-z][A-Za-z0-9_-]*)/g
const numberTokenPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function cleanToken(token: string): string {
  return token.replace(/^[\s"'([{]+/, "").replace(/[\s"'),\]}]+$/, "")
}

function parseParamToken(token: string, definition: SelectorParamDefinition): SelectorParamValue | undefined {
  const cleaned = cleanToken(token)
  if (!cleaned) return undefined
  if (definition.kind === "boolean") {
    if (cleaned.toLowerCase() === "true") return true
    if (cleaned.toLowerCase() === "false") return false
    return undefined
  }
  if (!numberTokenPattern.test(cleaned)) return undefined
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return undefined
  return definition.kind === "integer" ? Math.trunc(value) : value
}

export function getSelectorDefinition(type: SelectorType): SelectorDefinition | null {
  return SELECTOR_DEFINITIONS[type] ?? null
}

/** 从单行 Kether 中提取所有可静态求值的几何选择器。 */
export function parseSelectorsFromLine(line: string): ParsedSelector[] {
  const matches = [...line.matchAll(selectorTokenPattern)]
  const selectors: ParsedSelector[] = []

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    const alias = match[1].toLowerCase()
    const definition = definitionByAlias.get(alias)
    if (!definition || match.index == null) continue

    const valueStart = match.index + match[0].length
    const valueEnd = matches[index + 1]?.index ?? line.length
    const tokens = line.slice(valueStart, valueEnd).trim().split(/\s+/).filter(Boolean)
    const params: SelectorParamValue[] = []
    let useDefaults = false

    for (let paramIndex = 0; paramIndex < definition.params.length; paramIndex++) {
      const paramDefinition = definition.params[paramIndex]
      const parsed = useDefaults ? undefined : parseParamToken(tokens[paramIndex] ?? "", paramDefinition)
      if (parsed === undefined) useDefaults = true
      params.push(parsed ?? paramDefinition.defaultValue)
    }

    selectors.push({
      type: definition.type,
      params,
      label: definition.label(params),
    })
  }

  return selectors
}

/** 提取脚本中第一个选择器（兼容旧接口）。 */
export function parseSelectorFromScript(script: string): SelectorInfo | null {
  const first = parseAllSelectors(script)[0]
  return first ? { type: first.type, params: first.params } : null
}

/** 提取脚本中所有选择器及其所在 tick；位移动作不再伪装成选择器原点变化。 */
export function parseAllSelectors(script: string): TimedSelector[] {
  const selectors: TimedSelector[] = []
  let currentTick = 0
  const lines = script.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))

  for (const line of lines) {
    const sleepMatch = line.match(/^sleep\s+(\d+)/)
    if (sleepMatch) {
      currentTick += Number.parseInt(sleepMatch[1], 10)
      continue
    }
    const sleepMathMatch = line.match(/^sleep\s+math\s+div\s+\[\s*(\d+)/)
    if (sleepMathMatch) {
      currentTick += Number.parseInt(sleepMathMatch[1], 10)
      continue
    }

    for (const selector of parseSelectorsFromLine(line)) {
      selectors.push({ ...selector, tick: currentTick, raw: line })
    }
  }

  return selectors
}
