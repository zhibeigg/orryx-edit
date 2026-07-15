import { describe, expect, it } from "vitest"
import { createSelectorPreviewModel, PLAYER_EYE_HEIGHT } from "./selector-preview-geometry"

describe("选择器预览几何语义", () => {
  it("OBB 使用前方深度、中心偏移与眼睛原点", () => {
    const model = createSelectorPreviewModel("obb", [12, 4, 5, -3, -1, false])
    expect(model).toMatchObject({
      kind: "box",
      origin: "eyes",
      originY: PLAYER_EYE_HEIGHT,
      size: [4, 5, 12],
      center: [0, -1, -3],
    })
    if (!model || model.kind !== "box") throw new Error("expected box model")
    expect(model.center[2] - model.size[2] / 2).toBe(-9)
    expect(model.center[2] + model.size[2] / 2).toBe(3)
  })

  it("Line 从眼睛原点向前覆盖 [0, L]", () => {
    const model = createSelectorPreviewModel("line", [10, 1, 2, false])
    expect(model).toMatchObject({ kind: "box", size: [1, 2, 10], center: [0, 0, 5] })
  })

  it("Cone 顶点在原点且底面位于前方长度处", () => {
    const model = createSelectorPreviewModel("cone", [5, 10, 30, -1, true])
    expect(model).toMatchObject({
      kind: "cone",
      radius: 5,
      length: 10,
      center: [0, -1, 5],
      yawDegrees: 30,
      followPitch: true,
    })
  })

  it("Cylinder 按前方起点和轴向高度定位", () => {
    const model = createSelectorPreviewModel("cylinder", [5, 10, 3, -1, true])
    expect(model).toMatchObject({
      kind: "cylinder",
      radius: 5,
      length: 10,
      center: [0, -1, 8],
      followPitch: true,
    })
  })

  it("Frustum 保持近端和远端半径顺序", () => {
    const model = createSelectorPreviewModel("frustum", [1, 5, 10, -20, 2, false])
    expect(model).toMatchObject({
      kind: "frustum",
      nearRadius: 1,
      farRadius: 5,
      length: 10,
      center: [0, 2, 5],
      yawDegrees: -20,
    })
  })

  it("LookAt 将 tolerance 作为半角计算远端半径", () => {
    const model = createSelectorPreviewModel("lookat", [32, 5])
    expect(model).toMatchObject({ kind: "lookat", distance: 32, toleranceDegrees: 5, origin: "eyes" })
    if (!model || model.kind !== "lookat") throw new Error("expected lookat model")
    expect(model.farRadius).toBeCloseTo(32 * Math.tan(5 * Math.PI / 180))
  })

  it("Sector、Scatter 与脚底/眼睛原点遵循服务端定位", () => {
    expect(createSelectorPreviewModel("sector", [8, 90, 3, -2])).toMatchObject({
      kind: "sector",
      origin: "eyes",
      center: [0, -2, 0],
    })
    expect(createSelectorPreviewModel("scatter", [5, 10, 6])).toMatchObject({
      kind: "scatter",
      origin: "feet",
      center: [0, 0, 6],
    })
    expect(createSelectorPreviewModel("range", [10])).toMatchObject({ origin: "feet" })
    expect(createSelectorPreviewModel("nearest", [3, 32])).toMatchObject({ origin: "feet", radius: 32 })
  })
})
