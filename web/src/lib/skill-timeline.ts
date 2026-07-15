import { parseSelectorsFromLine, type ParsedSelector } from "./selector-parser"

export interface TimelineEvent {
  tick: number
  duration: number
  type: "sleep" | "damage" | "animation" | "launch" | "flash" | "sound" | "effect" | "potion" | "entity" | "selector" | "other"
  label: string
  raw: string
  /** 选择器事件附带的选择器数据。 */
  selector?: ParsedSelector
}

/**
 * 解析 Kether Actions 脚本中的时序事件。
 * 提取 sleep、damage、dragon ani、launch、flash 等动作的时间点。
 */
export function parseTimeline(script: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let currentTick = 0
  const lines = script.split("\n").map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    const sleepMatch = line.match(/^sleep\s+(\d+)/)
    if (sleepMatch) {
      const duration = Number.parseInt(sleepMatch[1], 10)
      events.push({
        tick: currentTick,
        duration,
        type: "sleep",
        label: `等待 ${duration}t`,
        raw: line,
      })
      currentTick += duration
      continue
    }

    const sleepMathMatch = line.match(/^sleep\s+math\s+div\s+\[\s*(\d+)/)
    if (sleepMathMatch) {
      const baseTick = Number.parseInt(sleepMathMatch[1], 10)
      events.push({
        tick: currentTick,
        duration: baseTick,
        type: "sleep",
        label: `等待 ~${baseTick}t`,
        raw: line,
      })
      currentTick += baseTick
      continue
    }

    // 统一复用 selector-parser；launch/direct/flash 均不作为静态选择器原点平移。
    const selector = parseSelectorsFromLine(line)[0] ?? null

    if (line.startsWith("damage ")) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "damage",
        label: selector ? `伤害 (${selector.label})` : "伤害",
        raw: line,
        selector: selector ?? undefined,
      })
      continue
    }

    if (selector) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "selector",
        label: selector.label,
        raw: line,
        selector,
      })
      // 不 continue，让同一行的动作仍可进入对应时间轴分类。
    }

    if (line.includes("dragon ani") || line.includes("dragon animation")) {
      const animationMatch = line.match(/dragon\s+ani\s+to\s+player\s+(\S+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "animation",
        label: animationMatch ? `动画: ${animationMatch[1]}` : "动画",
        raw: line,
      })
      continue
    }

    if (line.includes("dragon sound")) {
      const soundMatch = line.match(/dragon\s+sound\s+send\s+(\S+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "sound",
        label: soundMatch ? `音效: ${soundMatch[1]}` : "音效",
        raw: line,
      })
      continue
    }

    if (line.includes("dragon effect")) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "effect",
        label: "粒子特效",
        raw: line,
      })
      continue
    }

    if (line.startsWith("launch ")) {
      const launchMatch = line.match(/^launch\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "launch",
        label: launchMatch ? `速度 (${launchMatch[1]}, ${launchMatch[2]}, ${launchMatch[3]})` : "速度变更",
        raw: line,
      })
      continue
    }

    if (line.startsWith("flash ")) {
      const flashMatch = line.match(/^flash\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "flash",
        label: flashMatch ? `闪现 (${flashMatch[1]}, ${flashMatch[2]}, ${flashMatch[3]})` : "闪现",
        raw: line,
      })
      continue
    }

    if (line.includes("entity ady")) {
      const entityMatch = line.match(/entity\s+ady\s+(\S+)/)
      const timeoutMatch = line.match(/timeout\s+(\d+)/)
      events.push({
        tick: currentTick,
        duration: timeoutMatch ? Number.parseInt(timeoutMatch[1], 10) : 20,
        type: "entity",
        label: entityMatch ? `实体: ${entityMatch[1]}` : "实体动画",
        raw: line,
      })
      continue
    }

    if (line.startsWith("potion ")) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "potion",
        label: "药水效果",
        raw: line,
      })
    }
  }

  return events
}
