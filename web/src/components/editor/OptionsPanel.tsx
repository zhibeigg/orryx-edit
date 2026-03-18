import type { SkillOptions, SkillType } from "@/types"

interface OptionsPanelProps {
  options: SkillOptions
  onChange: (options: SkillOptions) => void
}

const SKILL_TYPES: SkillType[] = ["DIRECT", "DIRECT AIM", "PASSIVE", "PRESSING", "PRESSING AIM"]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
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

export function OptionsPanel({ options, onChange }: OptionsPanelProps) {
  const update = (patch: Partial<SkillOptions>) => onChange({ ...options, ...patch })

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">基础选项</h3>

      <div className="grid grid-cols-2 gap-3">
        <Field label="类型 (Type)">
          <select
            value={options.Type}
            onChange={(e) => update({ Type: e.target.value as SkillType })}
            className="w-full px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {SKILL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
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

        <Field label="最小等级 (MinLevel)">
          <Input value={options.MinLevel} onChange={(v) => update({ MinLevel: parseInt(v) || 1 })} type="number" />
        </Field>

        <Field label="最大等级 (MaxLevel)">
          <Input value={options.MaxLevel} onChange={(v) => update({ MaxLevel: parseInt(v) || 1 })} type="number" />
        </Field>

        <Field label="升级消耗点数 (UpgradePointAction)">
          <Input value={options.UpgradePointAction} onChange={(v) => update({ UpgradePointAction: parseInt(v) || 1 })} type="number" />
        </Field>
      </div>

      <Field label="是否锁定 (IsLocked)">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={options.IsLocked ?? false}
            onChange={(e) => update({ IsLocked: e.target.checked })}
            className="rounded"
          />
          <span>{options.IsLocked ? "已锁定" : "未锁定"}</span>
        </label>
      </Field>

      <Field label="升级检查 (UpLevelCheckAction)">
        <Input value={options.UpLevelCheckAction} onChange={(v) => update({ UpLevelCheckAction: v })} placeholder='check orryx level >= calc "2+3*(to-1)"' />
      </Field>

      <Field label="释放检查 (CastCheckAction)">
        <div className="flex gap-2">
          <select
            value={
              options.CastCheckAction === true ? "true"
                : options.CastCheckAction === false ? "false"
                  : "custom"
            }
            onChange={(e) => {
              if (e.target.value === "true") update({ CastCheckAction: true })
              else if (e.target.value === "false") update({ CastCheckAction: false })
              else update({ CastCheckAction: "" })
            }}
            className="px-3 py-1.5 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="true">启用</option>
            <option value="false">禁用</option>
            <option value="custom">自定义表达式</option>
          </select>
          {typeof options.CastCheckAction === "string" && (
            <Input
              value={options.CastCheckAction}
              onChange={(v) => update({ CastCheckAction: v })}
              placeholder="Kether 表达式..."
            />
          )}
        </div>
      </Field>
    </div>
  )
}
