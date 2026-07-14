export type DemoSkillId = "flame-slash" | "ice-guard" | "sword-flight"
export type DemoView = "parameters" | "timeline" | "yaml" | "runtime"
export type DemoPhase = "idle" | "schema" | "revision" | "sync" | "ready"

export interface DemoTimelineItem {
  id: string
  label: string
  detail: string
  start: number
  end: number
  tone: "selector" | "motion" | "damage" | "effect" | "state"
}

export interface DemoSkill {
  id: DemoSkillId
  fileName: string
  name: string
  type: string
  summary: string
  maxLevel: number
  cooldown: string
  mana: number
  formula: string
  selector: string
  revision: number
  totalTicks: number
  timeline: DemoTimelineItem[]
  yaml: string
  result: {
    selected: string
    affected: string
    reload: string
  }
}

export const demoSkills: Record<DemoSkillId, DemoSkill> = {
  "flame-slash": {
    id: "flame-slash",
    fileName: "烈焰斩.yml",
    name: "烈焰斩",
    type: "DIRECT",
    summary: "扇形选择目标，播放斩击动作，并在伤害结算后同步熔岩粒子。",
    maxLevel: 5,
    cooldown: "8.0 s",
    mana: 24,
    formula: "level × 1.8 + 24",
    selector: "fan 5 90",
    revision: 42,
    totalTicks: 42,
    timeline: [
      { id: "select", label: "扇形选区", detail: "半径 5 格 · 90°", start: 1, end: 7, tone: "selector" },
      { id: "motion", label: "播放动作", detail: "flame_slash", start: 6, end: 15, tone: "motion" },
      { id: "damage", label: "造成伤害", detail: "level × 1.8 + 24", start: 14, end: 27, tone: "damage" },
      { id: "effect", label: "熔岩粒子", detail: "particle flame", start: 23, end: 41, tone: "effect" },
    ],
    yaml: `Options:
  Type: DIRECT
  MaxLevel: 5
  Cooldown: 8
  Mana: 24
Actions: |-
  select fan 5 90
  animation flame_slash
  damage "level * 1.8 + 24"
  particle flame`,
    result: {
      selected: "3 个目标",
      affected: "damage · particle",
      reload: "skill ready",
    },
  },
  "ice-guard": {
    id: "ice-guard",
    fileName: "玄冰护体.yml",
    name: "玄冰护体",
    type: "CHANNEL",
    summary: "进入短暂引导后生成护盾，持续期间降低受到的伤害并维持冰霜效果。",
    maxLevel: 3,
    cooldown: "14.0 s",
    mana: 36,
    formula: "80 + level × 24",
    selector: "self",
    revision: 18,
    totalTicks: 64,
    timeline: [
      { id: "channel", label: "引导施法", detail: "24 ticks", start: 1, end: 24, tone: "motion" },
      { id: "shield", label: "生成护盾", detail: "80 + level × 24", start: 22, end: 31, tone: "state" },
      { id: "reduce", label: "伤害减免", detail: "35%", start: 29, end: 62, tone: "selector" },
      { id: "frost", label: "冰霜效果", detail: "particle snowflake", start: 25, end: 63, tone: "effect" },
    ],
    yaml: `Options:
  Type: CHANNEL
  MaxLevel: 3
  Cooldown: 14
  Mana: 36
Actions: |-
  channel 24
  shield "80 + level * 24"
  state damage-reduction 0.35
  particle snowflake`,
    result: {
      selected: "施法者",
      affected: "shield · state",
      reload: "state ready",
    },
  },
  "sword-flight": {
    id: "sword-flight",
    fileName: "御剑术.yml",
    name: "御剑术",
    type: "DIRECTED",
    summary: "沿视线锁定目标，驱动飞剑轨迹并在命中后触发穿透伤害。",
    maxLevel: 5,
    cooldown: "4.5 s",
    mana: 18,
    formula: "level × 2.4 + 16",
    selector: "ray 18 0.7",
    revision: 31,
    totalTicks: 36,
    timeline: [
      { id: "ray", label: "射线锁定", detail: "18 格 · 0.7 宽", start: 1, end: 8, tone: "selector" },
      { id: "launch", label: "飞剑出鞘", detail: "sword_launch", start: 6, end: 16, tone: "motion" },
      { id: "travel", label: "轨迹粒子", detail: "particle crit", start: 11, end: 29, tone: "effect" },
      { id: "pierce", label: "穿透伤害", detail: "level × 2.4 + 16", start: 27, end: 35, tone: "damage" },
    ],
    yaml: `Options:
  Type: DIRECTED
  MaxLevel: 5
  Cooldown: 4.5
  Mana: 18
Actions: |-
  select ray 18 0.7
  animation sword_launch
  particle crit
  damage "level * 2.4 + 16"`,
    result: {
      selected: "1 个目标",
      affected: "ray · damage",
      reload: "selector ready",
    },
  },
}

export const demoSkillOrder: DemoSkillId[] = ["flame-slash", "ice-guard", "sword-flight"]

export interface DemoState {
  skillId: DemoSkillId
  view: DemoView
  phase: DemoPhase
  revision: number
}

export type DemoAction =
  | { type: "select-skill"; skillId: DemoSkillId }
  | { type: "select-view"; view: DemoView }
  | { type: "start-validation" }
  | { type: "advance-validation" }
  | { type: "reset" }

export function createInitialDemoState(skillId: DemoSkillId = "flame-slash"): DemoState {
  return {
    skillId,
    view: "parameters",
    phase: "idle",
    revision: demoSkills[skillId].revision,
  }
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "select-skill":
      return createInitialDemoState(action.skillId)
    case "select-view":
      return { ...state, view: action.view }
    case "start-validation":
      if (state.phase === "schema" || state.phase === "revision" || state.phase === "sync") return state
      return { ...state, view: "runtime", phase: "schema" }
    case "advance-validation":
      if (state.phase === "schema") return { ...state, phase: "revision" }
      if (state.phase === "revision") return { ...state, phase: "sync" }
      if (state.phase === "sync") return { ...state, phase: "ready", revision: state.revision + 1 }
      return state
    case "reset":
      return createInitialDemoState(state.skillId)
  }
}

export const validationPhaseOrder: Exclude<DemoPhase, "idle">[] = ["schema", "revision", "sync", "ready"]

export function validationStepState(
  currentPhase: DemoPhase,
  stepPhase: Exclude<DemoPhase, "idle">,
): "pending" | "current" | "complete" {
  if (currentPhase === "idle") return "pending"
  const currentIndex = validationPhaseOrder.indexOf(currentPhase)
  const stepIndex = validationPhaseOrder.indexOf(stepPhase)
  if (stepIndex < currentIndex) return "complete"
  if (stepIndex === currentIndex) return currentPhase === "ready" ? "complete" : "current"
  return "pending"
}
