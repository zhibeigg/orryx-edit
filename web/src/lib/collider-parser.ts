export interface ColliderInfo {
  type: "range" | "obb" | "sector"
  params: number[]
}

export function parseColliderFromScript(script: string): ColliderInfo | null {
  // @range N
  const rangeMatch = script.match(/@range\s+([\d.]+)/)
  if (rangeMatch) {
    return { type: "range", params: [parseFloat(rangeMatch[1])] }
  }

  // @obb L W H offsetX offsetY
  const obbMatch = script.match(/@obb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.-]+)/)
  if (obbMatch) {
    return {
      type: "obb",
      params: [
        parseFloat(obbMatch[1]),
        parseFloat(obbMatch[2]),
        parseFloat(obbMatch[3]),
        parseFloat(obbMatch[4]),
        parseFloat(obbMatch[5]),
      ],
    }
  }

  // @sector R angle H
  const sectorMatch = script.match(/@sector\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (sectorMatch) {
    return {
      type: "sector",
      params: [
        parseFloat(sectorMatch[1]),
        parseFloat(sectorMatch[2]),
        parseFloat(sectorMatch[3]),
      ],
    }
  }

  return null
}
