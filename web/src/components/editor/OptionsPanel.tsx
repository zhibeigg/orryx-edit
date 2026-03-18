import type { SkillOptions, SkillType } from "@/types"

interface OptionsPanelProps {
  options: SkillOptions
  onChange: (options: SkillOptions) => void
}

const SKILL_TYPES: SkillType[] = ["DIRECT", "DIRECT AIM", "PASSIVE", "PRESSING", "PRESSING AIM"]

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

export function OptionsPanel({ options, onChange }: OptionsPanelProps) {
  const update = (patch: Partial<SkillOptions>) => onChange({ ...options, ...patch })
  const isAim = options.Type === "DIRECT AIM" || options.Type === "PRESSING AIM"
  const isPressing = options.Type === "PRESSING" || options.Type === "PRESSING AIM"

  return (
    <div className="space-y-4 p-4 max-w-3xl">
      {/* ---- 基础信息 ---- */}
      <Section title="基础信息">
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型 (Type)">
            <select
              value={options.Type}
              onChange={(e) => update({ Type: e.target.value as SkillType })}
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SKILL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
            <Input value={options.XMaterial} onChange={(v) => update({ XMaterial: v })} />
          </Field>
        </div>
      </Section>

      {/* ---- 等级 ---- */}
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

      {/* ---- 开关 ---- */}
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

      {/* ---- AIM 参数（仅 AIM 类型显示） ---- */}
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

      {/* ---- PRESSING 参数（仅蓄力类型显示） ---- */}
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
            <Input
              value={(options.PressBrockTriggers ?? []).join(", ")}
              onChange={(v) => update({ PressBrockTriggers: v.split(",").map(s => s.trim()).filter(Boolean) })}
              placeholder="DAMAGED, MOVE（逗号分隔）"
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
