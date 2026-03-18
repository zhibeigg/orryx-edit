export type SelectorType =
  | "range" | "sector" | "obb" | "line" | "cone" | "cylinder"
  | "frustum" | "annular" | "nearest" | "lookat" | "location"
  | "vector" | "scatter" | "ring" | "floor" | "rayhit"

export interface SelectorInfo {
  type: SelectorType
  params: number[]
  offset?: [number, number, number]
}

/** 带时间信息的选择器 */
export interface TimedSelector extends SelectorInfo {
  tick: number
  label: string
  raw: string
}

/** 提取脚本中第一个选择器（兼容旧接口） */
export function parseSelectorFromScript(script: string): SelectorInfo | null {
  const all = parseAllSelectors(script)
  return all.length > 0 ? { type: all[0].type, params: all[0].params, offset: all[0].offset } : null
}

/** 提取脚本中所有选择器及其所在 tick，追踪原点位移 */
export function parseAllSelectors(script: string): TimedSelector[] {
  const selectors: TimedSelector[] = []
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
    const hasOffset = offsetX !== 0 || offsetY !== 0 || offsetZ !== 0

    // @range N
    const rangeMatches = [...line.matchAll(/@range\s+([\d.]+)/g)]
    for (const m of rangeMatches) {
      selectors.push({
        type: "range",
        params: [parseFloat(m[1])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `球形 R=${m[1]}`,
        raw: line,
      })
    }

    // @obb L W H offsetX offsetY [followPitch]
    const obbMatches = [...line.matchAll(/@obb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.-]+)/g)]
    for (const m of obbMatches) {
      selectors.push({
        type: "obb",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `矩形 ${m[1]}×${m[2]}×${m[3]}`,
        raw: line,
      })
    }

    // @sector R angle H [yOffset]
    const sectorMatches = [...line.matchAll(/@sector\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.-]+))?/g)]
    for (const m of sectorMatches) {
      const params = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]
      if (m[4] !== undefined) params.push(parseFloat(m[4]))
      selectors.push({
        type: "sector",
        params,
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `扇形 R=${m[1]} ${m[2]}°`,
        raw: line,
      })
    }

    // @line L W H [followPitch]
    const lineMatches = [...line.matchAll(/@line\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of lineMatches) {
      selectors.push({
        type: "line",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `线形 ${m[1]}×${m[2]}×${m[3]}`,
        raw: line,
      })
    }

    // @cone R L [yaw yOffset followPitch]
    const coneMatches = [...line.matchAll(/@cone\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of coneMatches) {
      selectors.push({
        type: "cone",
        params: [parseFloat(m[1]), parseFloat(m[2])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `锥形 R=${m[1]} L=${m[2]}`,
        raw: line,
      })
    }

    // @cylinder R H [forwardOffset yOffset followPitch]
    const cylinderMatches = [...line.matchAll(/@cylinder\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.-]+)\s+([\d.-]+))?/g)]
    for (const m of cylinderMatches) {
      const params = [parseFloat(m[1]), parseFloat(m[2])]
      if (m[3] !== undefined) params.push(parseFloat(m[3]))
      if (m[4] !== undefined) params.push(parseFloat(m[4]))
      selectors.push({
        type: "cylinder",
        params,
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `圆柱 R=${m[1]} H=${m[2]}`,
        raw: line,
      })
    }

    // @frustum topR bottomR L [yaw yOffset followPitch]
    const frustumMatches = [...line.matchAll(/@frustum\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of frustumMatches) {
      selectors.push({
        type: "frustum",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `截锥 ${m[1]}→${m[2]} L=${m[3]}`,
        raw: line,
      })
    }

    // @annular minR maxR H
    const annularMatches = [...line.matchAll(/@annular\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of annularMatches) {
      selectors.push({
        type: "annular",
        params: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `环形 ${m[1]}~${m[2]} H=${m[3]}`,
        raw: line,
      })
    }

    // @nearest N R
    const nearestMatches = [...line.matchAll(/@nearest\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of nearestMatches) {
      selectors.push({
        type: "nearest",
        params: [parseFloat(m[1]), parseFloat(m[2])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `最近 N=${m[1]} R=${m[2]}`,
        raw: line,
      })
    }

    // @lookat dist angle
    const lookatMatches = [...line.matchAll(/@lookat\s+([\d.]+)\s+([\d.]+)/g)]
    for (const m of lookatMatches) {
      selectors.push({
        type: "lookat",
        params: [parseFloat(m[1]), parseFloat(m[2])],
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `注视 D=${m[1]} ${m[2]}°`,
        raw: line,
      })
    }

    // @scatter N R [forward]
    const scatterMatches = [...line.matchAll(/@scatter\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.-]+))?/g)]
    for (const m of scatterMatches) {
      const params = [parseFloat(m[1]), parseFloat(m[2])]
      if (m[3] !== undefined) params.push(parseFloat(m[3]))
      selectors.push({
        type: "scatter",
        params,
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `散射 N=${m[1]} R=${m[2]}`,
        raw: line,
      })
    }

    // @ring R N [yOffset]
    const ringMatches = [...line.matchAll(/@ring\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.-]+))?/g)]
    for (const m of ringMatches) {
      const params = [parseFloat(m[1]), parseFloat(m[2])]
      if (m[3] !== undefined) params.push(parseFloat(m[3]))
      selectors.push({
        type: "ring",
        params,
        offset: hasOffset ? [...currentOffset] : undefined,
        tick: currentTick,
        label: `环阵 R=${m[1]} N=${m[2]}`,
        raw: line,
      })
    }
  }

  return selectors
}
