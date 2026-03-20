/**
 * 交叉引用分析引擎
 * 扫描所有文件内容，提取 flag / cooldown / variable / cast 等引用关系
 */

export type RefType = "flag" | "cooldown" | "cast" | "skill-var" | "skill-cooldown" | "buff" | "potion"
export type RefAction = "set" | "check" | "remove" | "read" | "send"

export interface CrossRef {
  type: RefType
  name: string
  action: RefAction
  file: string
  line: number
  snippet: string
}

export interface RefGroup {
  type: RefType
  name: string
  refs: CrossRef[]
}

/** 从单个文件内容中提取所有引用 */
function extractRefs(file: string, content: string): CrossRef[] {
  const refs: CrossRef[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // flag 设置: flag xxx to ...
    for (const m of line.matchAll(/flag\s+(?:inline\s+)?"?([^\s"]+)"?\s+(?:to|set)\s/g)) {
      refs.push({ type: "flag", name: m[1], action: "set", file, line: lineNum, snippet: line.trim() })
    }

    // flag 移除: flag xxx remove/delete
    for (const m of line.matchAll(/flag\s+(?:inline\s+)?"?([^\s"]+)"?\s+(?:remove|delete)/g)) {
      refs.push({ type: "flag", name: m[1], action: "remove", file, line: lineNum, snippet: line.trim() })
    }

    // flag 检查: if flag xxx / flag xxx > / flag xxx >= / flag xxx == / check flag
    for (const m of line.matchAll(/(?:if|check)\s+flag\s+(?:inline\s+)?"?([^\s"]+)"?/g)) {
      refs.push({ type: "flag", name: m[1], action: "check", file, line: lineNum, snippet: line.trim() })
    }
    for (const m of line.matchAll(/flag\s+(?:inline\s+)?"?([^\s"]+)"?\s+[><=!]/g)) {
      if (!refs.some(r => r.file === file && r.line === lineNum && r.type === "flag" && r.name === m[1])) {
        refs.push({ type: "flag", name: m[1], action: "check", file, line: lineNum, snippet: line.trim() })
      }
    }

    // cooldown 设置: cooldown set xxx
    for (const m of line.matchAll(/cooldown\s+set\s+(.+)/g)) {
      refs.push({ type: "cooldown", name: m[1].trim().substring(0, 40), action: "set", file, line: lineNum, snippet: line.trim() })
    }

    // cooldown 检查（隐式：if cooldown / check cooldown）
    for (const _m of line.matchAll(/(?:if|check)\s+cooldown/g)) {
      void _m
      refs.push({ type: "cooldown", name: "(当前技能)", action: "check", file, line: lineNum, snippet: line.trim() })
    }

    // orryx skill var 技能名 *变量名 — 跨文件读取技能变量
    for (const m of line.matchAll(/orryx\s+skill\s+(?:variables?|var)\s+(\S+)\s+\*(\S+)/g)) {
      refs.push({ type: "skill-var", name: `${m[1]}.${m[2]}`, action: "read", file, line: lineNum, snippet: line.trim() })
    }

    // orryx skill cooldown 技能名 — 跨文件读取技能 CD
    for (const m of line.matchAll(/orryx\s+skill\s+cooldown\s+(\S+)/g)) {
      refs.push({ type: "skill-cooldown", name: m[1], action: "read", file, line: lineNum, snippet: line.trim() })
    }

    // cast 技能名
    for (const m of line.matchAll(/cast\s+(\S+)/g)) {
      refs.push({ type: "cast", name: m[1], action: "send", file, line: lineNum, snippet: line.trim() })
    }

    // buff send xxx / buff check xxx
    for (const m of line.matchAll(/buff\s+send\s+(\S+)/g)) {
      refs.push({ type: "buff", name: m[1], action: "send", file, line: lineNum, snippet: line.trim() })
    }
    for (const m of line.matchAll(/buff\s+(?:check|has)\s+(\S+)/g)) {
      refs.push({ type: "buff", name: m[1], action: "check", file, line: lineNum, snippet: line.trim() })
    }

    // potion set xxx
    for (const m of line.matchAll(/potion\s+set\s+(\S+)/g)) {
      refs.push({ type: "potion", name: m[1], action: "set", file, line: lineNum, snippet: line.trim() })
    }
  }

  return refs
}

/** 分析所有文件，返回全局引用列表 */
export function analyzeAllFiles(files: Map<string, string>): CrossRef[] {
  const allRefs: CrossRef[] = []
  for (const [path, content] of files) {
    allRefs.push(...extractRefs(path, content))
  }
  return allRefs
}

/** 获取当前文件中的标识符在其他文件中的引用 */
export function getCrossRefsForFile(currentFile: string, allRefs: CrossRef[]): RefGroup[] {
  // 当前文件中出现的所有标识符
  const currentRefs = allRefs.filter(r => r.file === currentFile)
  const identifiers = new Set(currentRefs.map(r => `${r.type}:${r.name}`))

  // 按标识符分组，包含所有文件中的引用
  const groups = new Map<string, RefGroup>()

  for (const key of identifiers) {
    const [type, name] = key.split(":", 2)
    const refs = allRefs.filter(r => r.type === type && r.name === name)
    if (refs.length > 1 || refs.some(r => r.file !== currentFile)) {
      groups.set(key, { type: type as RefType, name, refs })
    }
  }

  // 也查找其他文件引用了当前文件名（作为技能名）的情况
  const fileName = currentFile.split("/").pop()?.replace(".yml", "") ?? ""
  if (fileName) {
    // skill-var: 其他文件通过 orryx skill var 引用当前技能的变量
    const varRefs = allRefs.filter(r => r.type === "skill-var" && r.name.startsWith(fileName + "."))
    if (varRefs.length > 0) {
      const key = `skill-var:→${fileName}`
      groups.set(key, { type: "skill-var", name: `→ ${fileName}.*`, refs: varRefs })
    }

    // skill-cooldown: 其他文件引用当前技能的 cooldown
    const cdRefs = allRefs.filter(r => r.type === "skill-cooldown" && r.name === fileName)
    if (cdRefs.length > 0) {
      const key = `skill-cooldown:→${fileName}`
      groups.set(key, { type: "skill-cooldown", name: `→ ${fileName}`, refs: cdRefs })
    }

    // cast: 其他文件 cast 当前技能
    const castRefs = allRefs.filter(r => r.type === "cast" && r.name === fileName)
    if (castRefs.length > 0) {
      const key = `cast:→${fileName}`
      groups.set(key, { type: "cast", name: `→ ${fileName}`, refs: castRefs })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const typeOrder: Record<RefType, number> = { flag: 0, cooldown: 1, "skill-var": 2, "skill-cooldown": 3, cast: 4, buff: 5, potion: 6 }
    return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99)
  })
}

/** 引用类型的显示名 */
export function refTypeLabel(type: RefType): string {
  const labels: Record<RefType, string> = {
    flag: "Flag",
    cooldown: "Cooldown",
    cast: "Cast",
    "skill-var": "技能变量",
    "skill-cooldown": "技能CD",
    buff: "Buff",
    potion: "药水",
  }
  return labels[type] ?? type
}

/** 引用操作的显示名 */
export function refActionLabel(action: RefAction): string {
  const labels: Record<RefAction, string> = {
    set: "设置",
    check: "检查",
    remove: "移除",
    read: "读取",
    send: "发送",
  }
  return labels[action] ?? action
}

/** 引用操作的颜色 */
export function refActionColor(action: RefAction): string {
  const colors: Record<RefAction, string> = {
    set: "text-green-400",
    check: "text-blue-400",
    remove: "text-red-400",
    read: "text-yellow-400",
    send: "text-purple-400",
  }
  return colors[action] ?? "text-zinc-400"
}
