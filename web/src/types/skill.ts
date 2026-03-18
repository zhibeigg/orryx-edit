// 技能数据类型定义

export type SkillType = "DIRECT" | "DIRECT AIM" | "PASSIVE" | "PRESSING" | "PRESSING AIM"

export interface SkillOptions {
  Type: SkillType
  Name?: string
  Sort?: number | string
  Icon?: string
  XMaterial?: string
  Description?: string[]
  IsLocked?: boolean
  IgnoreSilence?: boolean
  MinLevel?: number
  MaxLevel?: number
  UpgradePointAction?: number | string
  UpLevelCheckAction?: string
  DownLevelCheckAction?: string
  UpLevelSuccessAction?: string
  DownLevelSuccessAction?: string
  CastCheckAction?: string | boolean
  Variables?: Record<string, string | number>
  // AIM 类型专属
  AimRadiusAction?: number
  AimSizeAction?: number
  AimMinAction?: number
  AimMaxAction?: number
  // PRESSING 类型专属
  Period?: number
  PressPeriodAction?: string
  MaxPressTickAction?: number
  PressBrockTriggers?: string[]
}

export interface SkillData {
  Options: SkillOptions
  Actions?: string
  ExtendActions?: Record<string, string>
}

// 职业数据类型
export interface JobOptions {
  Name: string
  Skills: string[]
  Attributes?: string[]
  RegainManaActions?: string
  MaxManaActions?: string
  RegainSpiritActions?: string
  MaxSpiritActions?: string
  UpgradePointActions?: string
  Experience?: string
}

export interface JobData {
  Options: JobOptions
}

// 经验配置类型
export interface ExperienceOptions {
  Min: number
  Max: number
  ExperienceOfLevel: string
}

export interface ExperienceData {
  Options: ExperienceOptions
}

// 配置文件类型
export type ConfigType =
  | "skill"
  | "job"
  | "controller"
  | "status"
  | "station"
  | "experience"
  | "buff"
  | "state"
  | "config"
  | "unknown"

export function getConfigType(path: string): ConfigType {
  if (path.startsWith("skills/")) return "skill"
  if (path.startsWith("jobs/")) return "job"
  if (path.startsWith("controllers/")) return "controller"
  if (path.startsWith("status/")) return "status"
  if (path.startsWith("stations/")) return "station"
  if (path === "buffs.yml") return "buff"
  if (path === "state.yml") return "state"
  if (path.startsWith("experiences/")) return "experience"
  if (path.startsWith("placeholders/")) return "config"
  if (path.startsWith("lang/")) return "config"
  if (path.startsWith("ui/")) return "config"
  if (path === "config.yml" || path === "datasource.yml" || path === "kether.yml" || path === "keys.yml" || path === "npc.yml" || path === "selectors.yml" || path === "bloom.yml") return "config"
  return "unknown"
}
