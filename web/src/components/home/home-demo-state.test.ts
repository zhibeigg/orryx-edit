import { describe, expect, it } from "vitest"
import {
  createInitialDemoState,
  demoReducer,
  validationStepState,
} from "./home-demo-state"

describe("home demo state", () => {
  it("switches skills and restores their base revision", () => {
    const state = demoReducer(createInitialDemoState(), { type: "select-skill", skillId: "ice-guard" })

    expect(state).toEqual({
      skillId: "ice-guard",
      view: "parameters",
      phase: "idle",
      revision: 18,
    })
  })

  it("switches the visible read-only view", () => {
    const state = demoReducer(createInitialDemoState(), { type: "select-view", view: "yaml" })

    expect(state.view).toBe("yaml")
    expect(state.phase).toBe("idle")
  })

  it("runs the complete validation sequence and advances the demo revision", () => {
    let state = demoReducer(createInitialDemoState(), { type: "start-validation" })
    expect(state.view).toBe("runtime")
    expect(state.phase).toBe("schema")

    state = demoReducer(state, { type: "advance-validation" })
    expect(state.phase).toBe("revision")

    state = demoReducer(state, { type: "advance-validation" })
    expect(state.phase).toBe("sync")

    state = demoReducer(state, { type: "advance-validation" })
    expect(state.phase).toBe("ready")
    expect(state.revision).toBe(43)
  })

  it("resets the active skill without changing the selection", () => {
    let state = createInitialDemoState("sword-flight")
    state = demoReducer(state, { type: "start-validation" })
    state = demoReducer(state, { type: "advance-validation" })
    state = demoReducer(state, { type: "reset" })

    expect(state).toEqual({
      skillId: "sword-flight",
      view: "parameters",
      phase: "idle",
      revision: 31,
    })
  })

  it("reports accessible validation step states", () => {
    expect(validationStepState("idle", "schema")).toBe("pending")
    expect(validationStepState("revision", "schema")).toBe("complete")
    expect(validationStepState("revision", "revision")).toBe("current")
    expect(validationStepState("ready", "ready")).toBe("complete")
  })
})
