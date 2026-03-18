export interface TimelineEvent {
  tick: number
  duration: number
  type: "sleep" | "damage" | "animation" | "launch" | "flash" | "sound" | "effect" | "potion" | "entity" | "collider" | "other"
  label: string
  raw: string
  /** 碰撞箱事件附带的碰撞箱数据 */
  collider?: { type: "range" | "obb" | "sector"; params: number[]; offset?: [number, number, number] }
}

/**
 * 解析 Kether Actions 脚本中的时序事件
 * 提取 sleep、damage、dragon ani、launch、flash 等动作的时间点
 */
export function parseTimeline(script: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let currentTick = 0
  // 追踪原点偏移
  let offsetX = 0, offsetY = 0, offsetZ = 0

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

    // 追踪位移语句
    const flashMatch = line.match(/^flash\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (flashMatch) {
      offsetX += parseFloat(flashMatch[1])
      offsetY += parseFloat(flashMatch[2])
      offsetZ += parseFloat(flashMatch[3])
    }
    const directMatch = line.match(/^direct\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (directMatch) {
      offsetX += parseFloat(directMatch[1])
      offsetY += parseFloat(directMatch[2])
      offsetZ += parseFloat(directMatch[3])
    }
    const launchMatch = line.match(/^launch\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (launchMatch) {
      offsetX += parseFloat(launchMatch[1])
      offsetY += parseFloat(launchMatch[2])
      offsetZ += parseFloat(launchMatch[3])
    }

    const currentOffset: [number, number, number] = [offsetX, offsetY, offsetZ]

    // damage（同时检测碰撞箱）
    if (line.startsWith("damage ")) {
      const collider = extractCollider(line, currentOffset)
      events.push({
        tick: currentTick,
        duration: 1,
        type: "damage",
        label: collider ? `伤害 (${collider.label})` : "伤害",
        raw: line,
        collider: collider ?? undefined,
      })
      continue
    }

    // 独立碰撞箱检测（非 damage 行中的选择器）
    if (!line.startsWith("damage ")) {
      const collider = extractCollider(line, currentOffset)
      if (collider) {
        events.push({
          tick: currentTick,
          duration: 1,
          type: "collider",
          label: collider.label,
          raw: line,
          collider,
        })
        // 不 continue，让后续匹配也能处理这行
      }
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

/** 从一行脚本中提取碰撞箱信息 */
function extractCollider(line: string, offset?: [number, number, number]): { type: "range" | "obb" | "sector"; params: number[]; offset?: [number, number, number]; label: string } | null {
  const hasOffset = offset && (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0)
  const obbMatch = line.match(/@obb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.-]+)/)
  if (obbMatch) {
    return {
      type: "obb",
      params: [parseFloat(obbMatch[1]), parseFloat(obbMatch[2]), parseFloat(obbMatch[3]), parseFloat(obbMatch[4]), parseFloat(obbMatch[5])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `矩形 ${obbMatch[1]}×${obbMatch[2]}×${obbMatch[3]}`,
    }
  }

  const sectorMatch = line.match(/@sector\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (sectorMatch) {
    return {
      type: "sector",
      params: [parseFloat(sectorMatch[1]), parseFloat(sectorMatch[2]), parseFloat(sectorMatch[3])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `扇形 R=${sectorMatch[1]} ${sectorMatch[2]}°`,
    }
  }

  const rangeMatch = line.match(/@range\s+([\d.]+)/)
  if (rangeMatch) {
    return {
      type: "range",
      params: [parseFloat(rangeMatch[1])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `球形 R=${rangeMatch[1]}`,
    }
  }

  return null
}
