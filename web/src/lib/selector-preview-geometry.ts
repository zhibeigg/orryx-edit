import type { SelectorParamValue, SelectorType } from "./selector-parser"

export const PLAYER_HEIGHT = 1.8
export const PLAYER_EYE_HEIGHT = 1.62

export type SelectorOrigin = "feet" | "eyes"
export type Vector3Tuple = [number, number, number]

interface BasePreviewModel {
  type: SelectorType
  origin: SelectorOrigin
  originY: number
  center: Vector3Tuple
  yawDegrees: number
  followPitch: boolean
}

export type SelectorPreviewModel =
  | (BasePreviewModel & { kind: "sphere"; radius: number })
  | (BasePreviewModel & { kind: "box"; size: Vector3Tuple })
  | (BasePreviewModel & { kind: "sector"; radius: number; angleDegrees: number; height: number })
  | (BasePreviewModel & { kind: "cone"; radius: number; length: number })
  | (BasePreviewModel & { kind: "cylinder"; radius: number; length: number })
  | (BasePreviewModel & { kind: "frustum"; nearRadius: number; farRadius: number; length: number })
  | (BasePreviewModel & { kind: "annular"; innerRadius: number; outerRadius: number; height: number })
  | (BasePreviewModel & { kind: "ring"; radius: number; amount: number })
  | (BasePreviewModel & { kind: "scatter"; radius: number; amount: number })
  | (BasePreviewModel & { kind: "lookat"; distance: number; toleranceDegrees: number; farRadius: number })

function numberAt(params: readonly SelectorParamValue[], index: number, fallback: number): number {
  const value = params[index]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function booleanAt(params: readonly SelectorParamValue[], index: number, fallback = false): boolean {
  const value = params[index]
  return typeof value === "boolean" ? value : fallback
}

function nonNegative(value: number): number {
  return Math.max(0, value)
}

function base(
  type: SelectorType,
  origin: SelectorOrigin,
  center: Vector3Tuple = [0, 0, 0],
  yawDegrees = 0,
  followPitch = false,
): BasePreviewModel {
  return {
    type,
    origin,
    originY: origin === "eyes" ? PLAYER_EYE_HEIGHT : 0,
    center,
    yawDegrees,
    followPitch,
  }
}

/** 将 Orryx 服务端选择器参数转换为与 getTargets() 一致的本地几何语义。 */
export function createSelectorPreviewModel(
  type: SelectorType,
  params: readonly SelectorParamValue[],
): SelectorPreviewModel | null {
  switch (type) {
    case "range":
      return { ...base(type, "feet"), kind: "sphere", radius: nonNegative(numberAt(params, 0, 10)) }
    case "obb": {
      const length = nonNegative(numberAt(params, 0, 0))
      const width = nonNegative(numberAt(params, 1, 0))
      const height = nonNegative(numberAt(params, 2, 0))
      const forward = numberAt(params, 3, 0)
      const offsetY = numberAt(params, 4, 0)
      return {
        ...base(type, "eyes", [0, offsetY, forward], 0, booleanAt(params, 5)),
        kind: "box",
        size: [width, height, length],
      }
    }
    case "sector":
      return {
        ...base(type, "eyes", [0, numberAt(params, 3, 0), 0]),
        kind: "sector",
        radius: nonNegative(numberAt(params, 0, 10)),
        angleDegrees: Math.min(360, nonNegative(numberAt(params, 1, 120))),
        height: nonNegative(numberAt(params, 2, 2)),
      }
    case "line": {
      const length = nonNegative(numberAt(params, 0, 10))
      return {
        ...base(type, "eyes", [0, 0, length / 2], 0, booleanAt(params, 3)),
        kind: "box",
        size: [nonNegative(numberAt(params, 1, 1)), nonNegative(numberAt(params, 2, 2)), length],
      }
    }
    case "cone": {
      const length = nonNegative(numberAt(params, 1, 10))
      return {
        ...base(type, "eyes", [0, numberAt(params, 3, 0), length / 2], numberAt(params, 2, 0), booleanAt(params, 4)),
        kind: "cone",
        radius: nonNegative(numberAt(params, 0, 5)),
        length,
      }
    }
    case "cylinder": {
      const length = nonNegative(numberAt(params, 1, 10))
      const forward = numberAt(params, 2, 0)
      return {
        ...base(type, "eyes", [0, numberAt(params, 3, 0), forward + length / 2], 0, booleanAt(params, 4)),
        kind: "cylinder",
        radius: nonNegative(numberAt(params, 0, 5)),
        length,
      }
    }
    case "frustum": {
      const length = nonNegative(numberAt(params, 2, 10))
      return {
        ...base(type, "eyes", [0, numberAt(params, 4, 0), length / 2], numberAt(params, 3, 0), booleanAt(params, 5)),
        kind: "frustum",
        nearRadius: nonNegative(numberAt(params, 0, 1)),
        farRadius: nonNegative(numberAt(params, 1, 10)),
        length,
      }
    }
    case "annular": {
      const firstRadius = nonNegative(numberAt(params, 0, 0))
      const secondRadius = nonNegative(numberAt(params, 1, 0))
      return {
        ...base(type, "feet"),
        kind: "annular",
        innerRadius: Math.min(firstRadius, secondRadius),
        outerRadius: Math.max(firstRadius, secondRadius),
        height: nonNegative(numberAt(params, 2, 0)),
      }
    }
    case "nearest":
      return { ...base(type, "feet"), kind: "sphere", radius: nonNegative(numberAt(params, 1, 32)) }
    case "lookat": {
      const distance = nonNegative(numberAt(params, 0, 32))
      const toleranceDegrees = Math.min(90, nonNegative(numberAt(params, 1, 5)))
      return {
        ...base(type, "eyes", [0, 0, distance / 2], 0, true),
        kind: "lookat",
        distance,
        toleranceDegrees,
        farRadius: distance * Math.tan(toleranceDegrees * Math.PI / 180),
      }
    }
    case "scatter":
      return {
        ...base(type, "feet", [0, 0, numberAt(params, 2, 0)]),
        kind: "scatter",
        radius: nonNegative(numberAt(params, 1, 10)),
        amount: Math.max(1, Math.trunc(numberAt(params, 0, 5))),
      }
    case "ring":
      return {
        ...base(type, "feet", [0, numberAt(params, 2, 0), 0]),
        kind: "ring",
        radius: nonNegative(numberAt(params, 0, 5)),
        amount: Math.max(1, Math.trunc(numberAt(params, 1, 8))),
      }
    default:
      return null
  }
}

export function selectorOriginLabel(origin: SelectorOrigin): string {
  return origin === "eyes" ? "玩家眼睛" : "玩家脚底"
}
