import type { SelectorType } from "./selector-parser"

export interface TimelineEvent {
  tick: number
  duration: number
  type: "sleep" | "damage" | "animation" | "launch" | "flash" | "sound" | "effect" | "potion" | "entity" | "selector" | "other"
  label: string
  raw: string
  /** 选择器事件附带的选择器数据 */
  selector?: { type: SelectorType; params: number[]; offset?: [number, number, number] }
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

    // damage（同时检测选择器）
    if (line.startsWith("damage ")) {
      const selector = extractSelector(line, currentOffset)
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

    // 独立选择器检测（非 damage 行中的选择器）
    if (!line.startsWith("damage ")) {
      const selector = extractSelector(line, currentOffset)
      if (selector) {
        events.push({
          tick: currentTick,
          duration: 1,
          type: "selector",
          label: selector.label,
          raw: line,
          selector,
        })
        // 不 continue，让后续匹配也能处理这行
      }
    }

    // dragon ani
    if (line.includes("dragon ani") || line.includes("dragon animation")) {
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

/** 从一行脚本中提取选择器信息 */
function extractSelector(line: string, offset?: [number, number, number]): { type: SelectorType; params: number[]; offset?: [number, number, number]; label: string } | null {
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

  const lineMatch = line.match(/@line\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (lineMatch) {
    return {
      type: "line",
      params: [parseFloat(lineMatch[1]), parseFloat(lineMatch[2]), parseFloat(lineMatch[3])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `线形 ${lineMatch[1]}×${lineMatch[2]}×${lineMatch[3]}`,
    }
  }

  const coneMatch = line.match(/@cone\s+([\d.]+)\s+([\d.]+)/)
  if (coneMatch) {
    return {
      type: "cone",
      params: [parseFloat(coneMatch[1]), parseFloat(coneMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `锥形 R=${coneMatch[1]} L=${coneMatch[2]}`,
    }
  }

  const cylinderMatch = line.match(/@cylinder\s+([\d.]+)\s+([\d.]+)/)
  if (cylinderMatch) {
    return {
      type: "cylinder",
      params: [parseFloat(cylinderMatch[1]), parseFloat(cylinderMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `圆柱 R=${cylinderMatch[1]} H=${cylinderMatch[2]}`,
    }
  }

  const frustumMatch = line.match(/@frustum\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (frustumMatch) {
    return {
      type: "frustum",
      params: [parseFloat(frustumMatch[1]), parseFloat(frustumMatch[2]), parseFloat(frustumMatch[3])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `截锥 ${frustumMatch[1]}→${frustumMatch[2]} L=${frustumMatch[3]}`,
    }
  }

  const annularMatch = line.match(/@annular\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (annularMatch) {
    return {
      type: "annular",
      params: [parseFloat(annularMatch[1]), parseFloat(annularMatch[2]), parseFloat(annularMatch[3])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `环形 ${annularMatch[1]}~${annularMatch[2]} H=${annularMatch[3]}`,
    }
  }

  const nearestMatch = line.match(/@nearest\s+([\d.]+)\s+([\d.]+)/)
  if (nearestMatch) {
    return {
      type: "nearest",
      params: [parseFloat(nearestMatch[1]), parseFloat(nearestMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `最近 N=${nearestMatch[1]} R=${nearestMatch[2]}`,
    }
  }

  const lookatMatch = line.match(/@lookat\s+([\d.]+)\s+([\d.]+)/)
  if (lookatMatch) {
    return {
      type: "lookat",
      params: [parseFloat(lookatMatch[1]), parseFloat(lookatMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `注视 D=${lookatMatch[1]} ${lookatMatch[2]}°`,
    }
  }

  const scatterMatch = line.match(/@scatter\s+([\d.]+)\s+([\d.]+)/)
  if (scatterMatch) {
    return {
      type: "scatter",
      params: [parseFloat(scatterMatch[1]), parseFloat(scatterMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `散射 N=${scatterMatch[1]} R=${scatterMatch[2]}`,
    }
  }

  const ringMatch = line.match(/@ring\s+([\d.]+)\s+([\d.]+)/)
  if (ringMatch) {
    return {
      type: "ring",
      params: [parseFloat(ringMatch[1]), parseFloat(ringMatch[2])],
      offset: hasOffset ? [...offset!] as [number, number, number] : undefined,
      label: `环阵 R=${ringMatch[1]} N=${ringMatch[2]}`,
    }
  }

  return null
}
