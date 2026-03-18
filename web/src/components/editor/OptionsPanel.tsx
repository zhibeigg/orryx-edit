import { useState, useRef, useEffect } from "react"
import type { SkillOptions, SkillType } from "@/types"

interface OptionsPanelProps {
  options: SkillOptions
  onChange: (options: SkillOptions) => void
}

const SKILL_TYPES: SkillType[] = ["DIRECT", "DIRECT AIM", "PASSIVE", "PRESSING", "PRESSING AIM"]

const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  "DIRECT": "直接释放",
  "DIRECT AIM": "指向性",
  "PASSIVE": "被动",
  "PRESSING": "蓄力",
  "PRESSING AIM": "蓄力指向性",
}

// 常用 Minecraft 材质（可搜索）
const COMMON_MATERIALS = [
  "DIAMOND_SWORD", "IRON_SWORD", "GOLDEN_SWORD", "STONE_SWORD", "WOODEN_SWORD", "NETHERITE_SWORD",
  "BOW", "CROSSBOW", "TRIDENT", "SHIELD",
  "DIAMOND_AXE", "IRON_AXE", "GOLDEN_AXE", "STONE_AXE", "WOODEN_AXE", "NETHERITE_AXE",
  "DIAMOND_PICKAXE", "IRON_PICKAXE", "GOLDEN_PICKAXE", "STONE_PICKAXE", "WOODEN_PICKAXE",
  "DIAMOND_SHOVEL", "IRON_SHOVEL", "GOLDEN_SHOVEL", "STONE_SHOVEL", "WOODEN_SHOVEL",
  "DIAMOND_HOE", "IRON_HOE", "GOLDEN_HOE", "STONE_HOE", "WOODEN_HOE",
  "DIAMOND_HELMET", "DIAMOND_CHESTPLATE", "DIAMOND_LEGGINGS", "DIAMOND_BOOTS",
  "IRON_HELMET", "IRON_CHESTPLATE", "IRON_LEGGINGS", "IRON_BOOTS",
  "NETHERITE_HELMET", "NETHERITE_CHESTPLATE", "NETHERITE_LEGGINGS", "NETHERITE_BOOTS",
  "LEATHER_HELMET", "LEATHER_CHESTPLATE", "LEATHER_LEGGINGS", "LEATHER_BOOTS",
  "BLAZE_ROD", "STICK", "BONE", "FEATHER", "BOOK", "ENCHANTED_BOOK",
  "ENDER_PEARL", "ENDER_EYE", "FIRE_CHARGE", "FIREWORK_ROCKET",
  "NETHER_STAR", "DRAGON_BREATH", "HEART_OF_THE_SEA", "TOTEM_OF_UNDYING",
  "POTION", "SPLASH_POTION", "LINGERING_POTION",
  "GOLDEN_APPLE", "ENCHANTED_GOLDEN_APPLE", "APPLE",
  "DIAMOND", "EMERALD", "GOLD_INGOT", "IRON_INGOT", "NETHERITE_INGOT",
  "REDSTONE", "GLOWSTONE_DUST", "GUNPOWDER", "SUGAR", "PAPER",
  "COMPASS", "CLOCK", "MAP", "FILLED_MAP", "SPYGLASS",
  "BARRIER", "STRUCTURE_VOID", "COMMAND_BLOCK",
  "GRASS_BLOCK", "STONE", "DIRT", "OAK_LOG", "OAK_PLANKS",
  "CHEST", "ENDER_CHEST", "CRAFTING_TABLE", "FURNACE", "ANVIL",
  "TNT", "BEACON", "CONDUIT", "BELL", "CAMPFIRE",
  "RED_DYE", "BLUE_DYE", "GREEN_DYE", "YELLOW_DYE", "WHITE_DYE", "BLACK_DYE",
  "PLAYER_HEAD", "SKELETON_SKULL", "WITHER_SKELETON_SKULL", "ZOMBIE_HEAD", "CREEPER_HEAD",
  "PAINTING", "ITEM_FRAME", "ARMOR_STAND", "NAME_TAG", "LEAD",
  "FISHING_ROD", "CARROT_ON_A_STICK", "WARPED_FUNGUS_ON_A_STICK",
  "SPECTRAL_ARROW", "TIPPED_ARROW", "ARROW",
  "SNOWBALL", "EGG", "EXPERIENCE_BOTTLE",
]

// 蓄力打断触发器
const TRIGGER_GROUPS: { label: string; triggers: string[] }[] = [
  {
    label: "玩家",
    triggers: [
      "Player Damaged Pre", "Player Damaged Post", "Player Damage Pre", "Player Damage Post",
      "Player Death", "Player Move", "Player Jump",
      "Player Toggle Sneak", "Player Toggle Sprint",
      "Player Interact", "Player Interact Entity",
    ],
  },
  {
    label: "Orryx",
    triggers: [
      "Orryx Player Skill Cast", "Orryx Player Press Start", "Orryx Player Press Stop",
      "Orryx Player Mana Down", "Orryx Player Spirit Down",
      "Orryx Player Job Change Pre", "Orryx Player Flag Change Post",
    ],
  },
  {
    label: "方块/实体",
    triggers: [
      "Block Break", "Block Place",
      "Entity Shoot Bow", "Projectile Hit", "Projectile Launch",
    ],
  },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-zinc-600">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = "text", placeholder }: {
  value: string | number | undefined
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      <span>{label}</span>
    </label>
  )
}

// ---- 可搜索 Combobox ----
function Combobox({ value, onChange, options, placeholder }: {
  value: string | undefined
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const filtered = search
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <input
        value={open ? search : (value ?? "")}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setSearch(value ?? "") }}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-lg">
          {filtered.slice(0, 50).map(opt => (
            <button
              key={opt}
              className="w-full text-left px-3 py-1 text-sm hover:bg-accent truncate"
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false) }}
            >
              {opt}
            </button>
          ))}
          {filtered.length > 50 && (
            <div className="px-3 py-1 text-xs text-muted-foreground">还有 {filtered.length - 50} 项，输入更多字符筛选...</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- 多选标签 ----
function TagSelect({ selected, onChange, groups }: {
  selected: string[]
  onChange: (v: string[]) => void
  groups: { label: string; triggers: string[] }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const toggle = (trigger: string) => {
    if (selected.includes(trigger)) onChange(selected.filter(t => t !== trigger))
    else onChange([...selected, trigger])
  }

  return (
    <div ref={ref} className="relative">
      <div
        className="min-h-[34px] px-2 py-1 bg-secondary border border-border rounded-md flex flex-wrap gap-1 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        {selected.length === 0 && <span className="text-sm text-muted-foreground py-0.5">点击选择触发器...</span>}
        {selected.map(t => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded">
            {t}
            <button
              onClick={(e) => { e.stopPropagation(); toggle(t) }}
              className="hover:text-red-400"
            >×</button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg">
          {groups.map(group => (
            <div key={group.label}>
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0">{group.label}</div>
              {group.triggers.map(t => (
                <button
                  key={t}
                  className="w-full text-left px-3 py-1 text-sm hover:bg-accent flex items-center gap-2"
                  onMouseDown={(e) => { e.preventDefault(); toggle(t) }}
                >
                  <span className={`w-3 h-3 rounded-sm border ${selected.includes(t) ? "bg-primary border-primary" : "border-border"}`} />
                  {t}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OptionsPanel({ options, onChange }: OptionsPanelProps) {
  const update = (patch: Partial<SkillOptions>) => onChange({ ...options, ...patch })
  const isAim = options.Type === "DIRECT AIM" || options.Type === "PRESSING AIM"
  const isPressing = options.Type === "PRESSING" || options.Type === "PRESSING AIM"

  return (
    <div className="space-y-4 p-4 max-w-3xl">
      <Section title="基础信息">
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型 (Type)">
            <select
              value={options.Type}
              onChange={(e) => update({ Type: e.target.value as SkillType })}
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SKILL_TYPES.map((t) => <option key={t} value={t}>{SKILL_TYPE_LABELS[t]} ({t})</option>)}
            </select>
          </Field>
          <Field label="名称 (Name)">
            <Input value={options.Name} onChange={(v) => update({ Name: v })} placeholder="技能名称" />
          </Field>
          <Field label="排序 (Sort)" hint="支持 Kether 表达式">
            <Input value={options.Sort} onChange={(v) => update({ Sort: isNaN(Number(v)) ? v : Number(v) })} />
          </Field>
          <Field label="图标 (Icon)" hint="支持 {{ }} 模板">
            <Input value={options.Icon} onChange={(v) => update({ Icon: v })} />
          </Field>
          <Field label="材质 (XMaterial)">
            <Combobox
              value={options.XMaterial}
              onChange={(v) => update({ XMaterial: v })}
              options={COMMON_MATERIALS}
              placeholder="搜索材质..."
            />
          </Field>
        </div>
      </Section>

      <Section title="等级">
        <div className="grid grid-cols-3 gap-3">
          <Field label="最小等级">
            <Input value={options.MinLevel} onChange={(v) => update({ MinLevel: parseInt(v) || 0 })} type="number" />
          </Field>
          <Field label="最大等级">
            <Input value={options.MaxLevel} onChange={(v) => update({ MaxLevel: parseInt(v) || 1 })} type="number" />
          </Field>
          <Field label="升级消耗点数" hint="数值或 Kether">
            <Input value={options.UpgradePointAction} onChange={(v) => update({ UpgradePointAction: isNaN(Number(v)) ? v : Number(v) })} placeholder="1" />
          </Field>
        </div>

        <Field label="升级检查 (UpLevelCheckAction)" hint="返回 Boolean">
          <Input value={options.UpLevelCheckAction} onChange={(v) => update({ UpLevelCheckAction: v })} placeholder='check orryx level >= calc "5+1*(to-1)"' />
        </Field>

        <Field label="降级检查 (DownLevelCheckAction)" hint="返回 Boolean">
          <Input value={options.DownLevelCheckAction} onChange={(v) => update({ DownLevelCheckAction: v })} placeholder="可选" />
        </Field>

        <Field label="升级成功执行 (UpLevelSuccessAction)">
          <Input value={options.UpLevelSuccessAction} onChange={(v) => update({ UpLevelSuccessAction: v })} placeholder="可选" />
        </Field>

        <Field label="降级成功执行 (DownLevelSuccessAction)">
          <Input value={options.DownLevelSuccessAction} onChange={(v) => update({ DownLevelSuccessAction: v })} placeholder="可选" />
        </Field>
      </Section>

      <Section title="开关">
        <div className="space-y-2">
          <Toggle label={`锁定 (IsLocked) — ${options.IsLocked ? "需要解锁才能使用" : "默认可用"}`} checked={options.IsLocked ?? false} onChange={(v) => update({ IsLocked: v })} />
          <Toggle label={`无视沉默 (IgnoreSilence) — ${options.IgnoreSilence ? "沉默时仍可释放" : "沉默时不可释放"}`} checked={options.IgnoreSilence ?? false} onChange={(v) => update({ IgnoreSilence: v })} />
        </div>

        <Field label="释放检查 (CastCheckAction)">
          <div className="flex gap-2">
            <select
              value={options.CastCheckAction === true ? "true" : options.CastCheckAction === false ? "false" : "custom"}
              onChange={(e) => {
                if (e.target.value === "true") update({ CastCheckAction: true })
                else if (e.target.value === "false") update({ CastCheckAction: false })
                else update({ CastCheckAction: "" })
              }}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md"
            >
              <option value="true">启用默认检查</option>
              <option value="false">禁用</option>
              <option value="custom">自定义表达式</option>
            </select>
            {typeof options.CastCheckAction === "string" && (
              <Input value={options.CastCheckAction} onChange={(v) => update({ CastCheckAction: v })} placeholder="Kether 表达式..." />
            )}
          </div>
        </Field>
      </Section>

      {isAim && (
        <Section title="指向参数 (AIM)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="指向半径 (AimRadiusAction)">
              <Input value={options.AimRadiusAction} onChange={(v) => update({ AimRadiusAction: parseFloat(v) || 0 })} type="number" />
            </Field>
            <Field label="指向大小 (AimSizeAction)">
              <Input value={options.AimSizeAction} onChange={(v) => update({ AimSizeAction: parseFloat(v) || 0 })} type="number" />
            </Field>
            {options.Type === "PRESSING AIM" && (
              <>
                <Field label="初始大小 (AimMinAction)">
                  <Input value={options.AimMinAction} onChange={(v) => update({ AimMinAction: parseFloat(v) || 0 })} type="number" />
                </Field>
                <Field label="最大大小 (AimMaxAction)">
                  <Input value={options.AimMaxAction} onChange={(v) => update({ AimMaxAction: parseFloat(v) || 0 })} type="number" />
                </Field>
              </>
            )}
          </div>
        </Section>
      )}

      {isPressing && (
        <Section title="蓄力参数 (PRESSING)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="蓄力周期 (Period)" hint="tick">
              <Input value={options.Period} onChange={(v) => update({ Period: parseInt(v) || 0 })} type="number" />
            </Field>
            <Field label="最大蓄力 (MaxPressTickAction)" hint="tick">
              <Input value={options.MaxPressTickAction} onChange={(v) => update({ MaxPressTickAction: parseInt(v) || 0 })} type="number" />
            </Field>
          </div>

          <Field label="蓄力周期脚本 (PressPeriodAction)" hint="每 Period tick 执行一次">
            <Input value={options.PressPeriodAction} onChange={(v) => update({ PressPeriodAction: v })} placeholder="Kether 脚本" />
          </Field>

          <Field label="蓄力打断触发器 (PressBrockTriggers)">
            <TagSelect
              selected={options.PressBrockTriggers ?? []}
              onChange={(v) => update({ PressBrockTriggers: v })}
              groups={TRIGGER_GROUPS}
            />
          </Field>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">{title}</h3>
      {children}
    </div>
  )
}
