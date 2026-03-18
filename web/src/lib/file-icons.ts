import {
  Swords, Briefcase, Activity, BarChart3, Zap, Settings, Sparkles,
  Shield, FileText, Bot, Key, Palette, Hash, Workflow, type LucideIcon,
} from "lucide-react"
import type { ConfigType } from "@/types"
import { getConfigType } from "@/types"

interface FileIconInfo {
  icon: LucideIcon
  color: string
}

const CONFIG_ICONS: Record<ConfigType, FileIconInfo> = {
  skill:       { icon: Swords,    color: "text-red-400" },
  job:         { icon: Briefcase, color: "text-blue-400" },
  station:     { icon: Activity,  color: "text-green-400" },
  experience:  { icon: BarChart3, color: "text-yellow-400" },
  status:      { icon: Workflow,  color: "text-purple-400" },
  controller:  { icon: Zap,       color: "text-orange-400" },
  buff:        { icon: Shield,    color: "text-cyan-400" },
  state:       { icon: Workflow,  color: "text-purple-400" },
  config:      { icon: Settings,  color: "text-zinc-400" },
  unknown:     { icon: FileText,  color: "text-muted-foreground" },
}

// 单文件特殊图标
const FILE_ICONS: Record<string, FileIconInfo> = {
  "bloom.yml":      { icon: Sparkles, color: "text-pink-400" },
  "buffs.yml":      { icon: Shield,   color: "text-cyan-400" },
  "config.yml":     { icon: Settings, color: "text-zinc-400" },
  "keys.yml":       { icon: Key,      color: "text-amber-400" },
  "npc.yml":        { icon: Bot,      color: "text-emerald-400" },
  "selectors.yml":  { icon: Hash,     color: "text-indigo-400" },
  "state.yml":      { icon: Workflow, color: "text-purple-400" },
}

// 文件夹图标颜色
const FOLDER_COLORS: Record<string, string> = {
  "skills":       "text-red-400",
  "jobs":         "text-blue-400",
  "stations":     "text-green-400",
  "experiences":  "text-yellow-400",
  "status":       "text-purple-400",
  "controllers":  "text-orange-400",
  "placeholders": "text-indigo-400",
  "lang":         "text-zinc-400",
  "ui":           "text-pink-400",
}

export function getFileIconInfo(path: string): FileIconInfo {
  // 单文件特殊图标
  if (FILE_ICONS[path]) return FILE_ICONS[path]

  // placeholder 特殊处理
  if (path.startsWith("placeholders/")) return { icon: Hash, color: "text-indigo-400" }
  if (path.startsWith("lang/")) return { icon: Palette, color: "text-zinc-400" }
  if (path.startsWith("ui/")) return { icon: Palette, color: "text-pink-400" }

  // 按 ConfigType
  const configType = getConfigType(path)
  return CONFIG_ICONS[configType]
}

export function getFolderColor(name: string): string {
  return FOLDER_COLORS[name] ?? "text-yellow-500"
}
