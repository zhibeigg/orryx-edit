import type { SkillOptions, SkillType } from "@/types"
import { ActionsEditor } from "./ActionsEditor"

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
        {hint && <span className="ml-1 text-zinc-600">— {hint}</span>}
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
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
    <div className="space-y-5 p-4 max-w-3xl">
      {/* 基础信息 */}
      <Section title="基础信息">
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型 (Type)">
            <select
              value={options.Type}
              onChange={(e) => update({ Type: e.target.value as SkillType })}
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SKILL_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </Field>
          <Field label="名称 (Name)">
            <Input value={options.Name} onChange={(v) => update({ Name: v })} placeholder="技能名称" />
          </Field>
          <Field label="排序 (Sort)">
            <Input value={options.Sort} onChange={(v) => update({ Sort: parseInt(v) || 0 })} type="number" />
          </Field>
          <Field label="图标 (Icon)">
            <Input value={options.Icon} onChange={(v) => update({ Icon: v })} />
          </Field>
          <Field label="材质 (XMaterial)">
            <Input value={options.XMaterial} onChange={(v) => update({ XMaterial: v })} />
          </Field>
        </div>
      </Section>

      {/* 等级 */}
      <Section title="等级设置">
        <div className="grid grid-cols-3 gap-3">
          <Field label="最小等级 (MinLevel)" hint=">0 自动学会">
            <Input value={options.MinLevel} onChange={(v) => update({ MinLevel: parseInt(v) || 1 })} type="number" />
          </Field>
          <Field label="最大等级 (MaxLevel)">
            <Input value={options.MaxLevel} onChange={(v) => update({ MaxLevel: parseInt(v) || 1 })} type="number" />
          </Field>
          <Field label="升级消耗点数" hint="数字或 Kether 表达式">
            <Input
              value={options.UpgradePointAction}
              onChange={(v) => {
                const n = parseInt(v)
                update({ UpgradePointAction: isNaN(n) ? v : n })
              }}
              placeholder="1"
            />
          </Field>
        </div>
      </Section>

      {/* 开关 */}
      <Section title="开关">
        <div className="flex gap-6">
          <Toggle checked={options.IsLocked ?? false} onChange={(v) => update({ IsLocked: v })} label="需要解锁 (IsLocked)" />
          <Toggle checked={options.IgnoreSilence ?? false} onChange={(v) => update({ IgnoreSilence: v })} label="无视沉默 (IgnoreSilence)" />
        </div>
      </Section>

      {/* 检查脚本 */}
      <Section title="检查脚本">
        <Field label="释放检查 (CastCheckAction)">
          <div className="flex gap-2">
            <select
              value={options.CastCheckAction === true ? "true" : options.CastCheckAction === false ? "false" : "custom"}
              onChange={(e) => {
                if (e.target.value === "true") update({ CastCheckAction: true })
                else if (e.target.value === "false") update({ CastCheckAction: false })
                else update({ CastCheckAction: "" })
              }}
              className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md shrink-0"
            >
              <option value="true">启用默认</option>
              <option value="false">禁用</option>
              <option value="custom">自定义</option>
            </select>
            {typeof options.CastCheckAction === "string" && (
              <Input value={options.CastCheckAction} onChange={(v) => update({ CastCheckAction: v })} placeholder="Kether 表达式" />
            )}
          </div>
        </Field>

        <Field label="升级检查 (UpLevelCheckAction)" hint="返回 Boolean">
          <ActionsEditor value={options.UpLevelCheckAction ?? ""} onChange={(v) => update({ UpLevelCheckAction: v })} height="60px" />
        </Field>

        <Field label="降级检查 (DownLevelCheckAction)" hint="返回 Boolean">
          <ActionsEditor value={options.DownLevelCheckAction ?? ""} onChange={(v) => update({ DownLevelCheckAction: v })} height="60px" />
        </Field>

        <Field label="升级成功 (UpLevelSuccessAction)">
          <ActionsEditor value={options.UpLevelSuccessAction ?? ""} onChange={(v) => update({ UpLevelSuccessAction: v })} height="60px" />
        </Field>

        <Field label="降级成功 (DownLevelSuccessAction)">
          <ActionsEditor value={options.DownLevelSuccessAction ?? ""} onChange={(v) => update({ DownLevelSuccessAction: v })} height="60px" />
        </Field>
      </Section>

      {/* AIM 类型专属 */}
      {isAim && (
        <Section title="指示器 (AIM)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="指示半径 (AimRadiusAction)">
              <Input value={options.AimRadiusAction} onChange={(v) => update({ AimRadiusAction: parseFloat(v) || 0 })} type="number" />
            </Field>
            <Field label="指示大小 (AimSizeAction)">
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

      {/* PRESSING 类型专属 */}
      {isPressing && (
        <Section title="蓄力 (PRESSING)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="蓄力周期 (Period)" hint="tick">
              <Input value={options.Period} onChange={(v) => update({ Period: parseInt(v) || 0 })} type="number" />
            </Field>
            <Field label="最大蓄力 (MaxPressTickAction)" hint="tick">
              <Input value={options.MaxPressTickAction} onChange={(v) => update({ MaxPressTickAction: parseInt(v) || 0 })} type="number" />
            </Field>
          </div>

          <Field label="蓄力周期脚本 (PressPeriodAction)">
            <ActionsEditor value={options.PressPeriodAction ?? ""} onChange={(v) => update({ PressPeriodAction: v })} height="60px" />
          </Field>

          <Field label="蓄力打断触发器 (PressBrockTriggers)" hint="每行一个">
            <textarea
              className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md font-mono h-20 resize-y"
              value={(options.PressBrockTriggers ?? []).join("\n")}
              onChange={(e) => update({ PressBrockTriggers: e.target.value.split("\n").filter(Boolean) })}
              placeholder="DAMAGED&#10;MOVE"
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
