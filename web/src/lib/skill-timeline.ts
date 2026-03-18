export interface TimelineEvent {
  tick: number
  duration: number
  type: "sleep" | "damage" | "animation" | "launch" | "flash" | "sound" | "effect" | "potion" | "entity" | "other"
  label: string
  raw: string
}

/**
 * 解析 Kether Actions 脚本中的时序事件
 * 提取 sleep、damage、dragon ani、launch、flash 等动作的时间点
 */
export function parseTimeline(script: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let currentTick = 0

  const lines = script.split("\n").map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    // sleep N
    const sleepMatch = line.match(/^sleep\s+(\d+)/)
    if (sleepMatch) {
      const duration = parseInt(sleepMatch[1])
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

    // sleep math div [ N &attackSpeed ]
    const sleepMathMatch = line.match(/^sleep\s+math\s+div\s+\[\s*(\d+)/)
    if (sleepMathMatch) {
      const baseTick = parseInt(sleepMathMatch[1])
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

    // damage
    if (line.startsWith("damage ")) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "damage",
        label: "伤害",
        raw: line,
      })
      continue
    }

    // dragon ani
    if (line.includes("dragon ani") || line.includes("dragon ani")) {
      const aniMatch = line.match(/dragon\s+ani\s+to\s+player\s+(\S+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "animation",
        label: aniMatch ? `动画: ${aniMatch[1]}` : "动画",
        raw: line,
      })
      continue
    }

    // dragon sound
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

    // dragon effect
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

    // launch
    if (line.startsWith("launch ")) {
      const launchMatch = line.match(/^launch\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "launch",
        label: launchMatch ? `位移 (${launchMatch[1]}, ${launchMatch[2]}, ${launchMatch[3]})` : "位移",
        raw: line,
      })
      continue
    }

    // flash
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

    // entity ady
    if (line.includes("entity ady")) {
      const entityMatch = line.match(/entity\s+ady\s+(\S+)/)
      const timeoutMatch = line.match(/timeout\s+(\d+)/)
      events.push({
        tick: currentTick,
        duration: timeoutMatch ? parseInt(timeoutMatch[1]) : 20,
        type: "entity",
        label: entityMatch ? `实体: ${entityMatch[1]}` : "实体动画",
        raw: line,
      })
      continue
    }

    // potion
    if (line.startsWith("potion ")) {
      events.push({
        tick: currentTick,
        duration: 1,
        type: "potion",
        label: "药水效果",
        raw: line,
      })
      continue
    }
  }

  return events
}
