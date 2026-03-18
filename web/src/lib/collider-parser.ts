export interface ColliderInfo {
  type: "range" | "obb" | "sector"
  params: number[]
  /** 原点偏移 [x, y, z]，由之前的位移语句累积 */
  offset?: [number, number, number]
}

/** 带时间信息的碰撞箱 */
export interface TimedCollider extends ColliderInfo {
  tick: number
  label: string
  raw: string
}

/** 提取脚本中第一个碰撞箱（兼容旧接口） */
export function parseColliderFromScript(script: string): ColliderInfo | null {
  const all = parseAllColliders(script)
  return all.length > 0 ? { type: all[0].type, params: all[0].params, offset: all[0].offset } : null
}

/** 提取脚本中所有碰撞箱及其所在 tick，追踪原点位移 */
export function parseAllColliders(script: string): TimedCollider[] {
  const colliders: TimedCollider[] = []
  let currentTick = 0
  // 累积原点偏移（视角坐标系：x=前方, y=上方, z=右方）
  let offsetX = 0, offsetY = 0, offsetZ = 0

  const lines = script.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))

  for (const line of lines) {
    // sleep 推进时间
    const sleepMatch = line.match(/^sleep\s+(\d+)/)
    if (sleepMatch) {
      currentTick += parseInt(sleepMatch[1])
      continue
    }
    const sleepMathMatch = line.match(/^sleep\s+math\s+div\s+\[\s*(\d+)/)
    if (sleepMathMatch) {
      currentTick += parseInt(sleepMathMatch[1])
      continue
    }

    // 追踪位移语句
    // flash <前方> <上方> <右方> ...
    const flashMatch = line.match(/^flash\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (flashMatch) {
      offsetX += parseFloat(flashMatch[1])
      offsetY += parseFloat(flashMatch[2])
      offsetZ += parseFloat(flashMatch[3])
    }

    // direct <前方> <上方> <右方> ...
    const directMatch = line.match(/^direct\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (directMatch) {
      offsetX += parseFloat(directMatch[1])
      offsetY += parseFloat(directMatch[2])
      offsetZ += parseFloat(directMatch[3])
    }

    // launch <前方> <上方> <右方> ...
    const launchMatch = line.match(/^launch\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/)
    if (launchMatch) {
      offsetX += parseFloat(launchMatch[1])
      offsetY += parseFloat(launchMatch[2])
      offsetZ += parseFloat(launchMatch[3])
    }

    const currentOffset: [number, number, number] = [offsetX, offsetY, offsetZ]
    const hasOffset = offsetX !== 0 || offsetY !== 0 || offsetZ !== 0

    // 提取行内所有碰撞箱选择器
    // @range N
    const rangeMatches = [...line.matchAll(/@range\s+([\d.]+)/g)]
    for (const m of rangeMatches) {
      colliders.push({
        type: "range",
        params: [parseFloat(m[1])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `球形 R=${m[1]}`,
        raw: line,
      })
    }

    // @obb L W H offsetX offsetY [forward]
    const obbMatches = [...line.matchAll(/@obb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.-]+)/g)]
    for (const m of obbMatches) {
      colliders.push({
        type: "obb",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `矩形 ${m[1]}×${m[2]}×${m[3]}`,
        raw: line,
      })
    }

    // @sector R angle H
    const sectorMatches = [...line.matchAll(/@sector\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of sectorMatches) {
      colliders.push({
        type: "sector",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `扇形 R=${m[1]} ${m[2]}°`,
        raw: line,
      })
    }
  }

  return colliders
}
