import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import type { JobData, JobOptions } from "@/types"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { useEditorStore } from "@/store/editor-store"
import { ActionsEditor } from "./ActionsEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"

interface JobEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

type Tab = "general" | "skills" | "attributes" | "scripts" | "refs" | "yaml"

export function JobEditor({ content, onChange, filePath }: JobEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("general")
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const job = useMemo<JobData>(() => {
    try {
      return parseYaml<JobData>(content)
    } catch {
      return { Options: { Name: "", Skills: [] } }
    }
  }, [content])

  const updateJob = useCallback((updater: (j: JobData) => JobData) => {
    const updated = updater(job)
    try {
      const newYaml = updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>)
      onChange(newYaml)
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [job, onChange])

  const updateOptions = useCallback((patch: Partial<JobOptions>) => {
    updateJob((j) => ({ ...j, Options: { ...j.Options, ...patch } }))
  }, [updateJob])

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "基础信息" },
    { id: "skills", label: "技能列表" },
    { id: "attributes", label: "属性" },
    { id: "scripts", label: "脚本" },
    { id: "refs", label: "引用" },
    { id: "yaml", label: "YAML 源码" },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-background shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "general" && (
          <GeneralPanel options={job.Options} onChange={updateOptions} />
        )}

        {activeTab === "skills" && (
          <SkillsPanel skills={job.Options.Skills ?? []} onChange={(skills) => updateOptions({ Skills: skills })} />
        )}

        {activeTab === "attributes" && (
          <AttributesPanel
            attributes={job.Options.Attributes ?? []}
            onChange={(attrs) => updateOptions({ Attributes: attrs })}
          />
        )}

        {activeTab === "scripts" && (
          <ScriptsPanel options={job.Options} onChange={updateOptions} />
        )}

        {activeTab === "refs" && filePath && <CrossRefPanel currentFile={filePath} />}
        {activeTab === "refs" && !filePath && (
          <div className="p-4 text-sm text-muted-foreground">无法分析引用：未知文件路径。</div>
        )}

        {activeTab === "yaml" && (
          <div className="h-full">
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={content}
              onChange={(v) => onChange(v ?? "")}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                insertSpaces: true,
                automaticLayout: true,
                padding: { top: 4 },
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---- 基础信息面板 ----
function GeneralPanel({ options, onChange }: { options: JobOptions; onChange: (p: Partial<JobOptions>) => void }) {
  // 从文件缓存中提取 experiences/ 目录下的文件名作为选项
  const expOptions = useMemo(() => {
    const cache = useEditorStore.getState().fileContents
    const names: string[] = []
    for (const key of cache.keys()) {
      if (key.startsWith("experiences/") && key.endsWith(".yml")) {
        names.push(key.replace("experiences/", "").replace(".yml", ""))
      }
    }
    if (names.length === 0) names.push("default")
    return names
  }, [])

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <Field label="职业名称">
        <input
          className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={options.Name ?? ""}
          onChange={(e) => onChange({ Name: e.target.value })}
        />
      </Field>

      <Field label="经验配置">
        <select
          className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={options.Experience ?? "default"}
          onChange={(e) => onChange({ Experience: e.target.value })}
        >
          {expOptions.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </Field>
    </div>
  )
}

// ---- 技能列表面板 ----
function SkillsPanel({ skills, onChange }: { skills: string[]; onChange: (s: string[]) => void }) {
  const [search, setSearch] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 从文件缓存中提取所有技能名
  const availableSkills = useMemo(() => {
    const cache = useEditorStore.getState().fileContents
    const names: string[] = []
    for (const key of cache.keys()) {
      if (key.startsWith("skills/") && key.endsWith(".yml")) {
        // 只取文件名（去掉路径和扩展名）
        const fileName = key.substring(key.lastIndexOf("/") + 1).replace(".yml", "")
        if (!names.includes(fileName)) names.push(fileName)
      }
    }
    return names.sort()
  }, [])

  // 过滤：排除已添加的 + 搜索匹配
  const filtered = availableSkills.filter(
    (name) => !skills.includes(name) && (!search || name.toLowerCase().includes(search.toLowerCase()))
  )

  const addSkill = (name: string) => {
    if (!name.trim() || skills.includes(name)) return
    onChange([...skills, name])
    setSearch("")
    setShowDropdown(false)
  }

  const removeSkill = (index: number) => {
    onChange(skills.filter((_, i) => i !== index))
  }

  const moveSkill = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= skills.length) return
    const arr = [...skills]
    ;[arr[index], arr[target]] = [arr[target], arr[index]]
    onChange(arr)
  }

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div className="p-4 space-y-3 max-w-2xl">
      <div className="relative" ref={dropdownRef}>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-muted border border-border rounded px-3 py-1.5 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) {
                // 精确匹配或手动输入
                const exact = availableSkills.find(s => s.toLowerCase() === search.toLowerCase())
                addSkill(exact ?? search.trim())
              }
            }}
            placeholder="搜索或输入技能名称..."
          />
          <button
            onClick={() => {
              if (search.trim()) {
                const exact = availableSkills.find(s => s.toLowerCase() === search.toLowerCase())
                addSkill(exact ?? search.trim())
              }
            }}
            disabled={!search.trim()}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            添加
          </button>
        </div>
        {showDropdown && filtered.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-12 mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-lg">
            {filtered.slice(0, 30).map((name) => (
              <button
                key={name}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent font-mono"
                onMouseDown={(e) => { e.preventDefault(); addSkill(name) }}
              >
                {name}
              </button>
            ))}
            {filtered.length > 30 && (
              <div className="px-3 py-1 text-xs text-muted-foreground">还有 {filtered.length - 30} 项...</div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1">
        {skills.map((skill, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded border border-border group">
            <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
            <span className="flex-1 text-sm font-mono">{skill}</span>
            <button
              onClick={() => moveSkill(i, -1)}
              disabled={i === 0}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 opacity-0 group-hover:opacity-100"
            >
              ↑
            </button>
            <button
              onClick={() => moveSkill(i, 1)}
              disabled={i === skills.length - 1}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 opacity-0 group-hover:opacity-100"
            >
              ↓
            </button>
            <button
              onClick={() => removeSkill(i)}
              className="text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100"
            >
              删除
            </button>
          </div>
        ))}
        {skills.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center">暂无技能，搜索或输入名称添加</div>
        )}
      </div>
    </div>
  )
}

// ---- 属性面板 ----
function AttributesPanel({ attributes, onChange }: { attributes: string[]; onChange: (a: string[]) => void }) {
  const [newAttr, setNewAttr] = useState("")

  const addAttr = () => {
    const val = newAttr.trim()
    if (!val) return
    onChange([...attributes, val])
    setNewAttr("")
  }

  const removeAttr = (index: number) => {
    onChange(attributes.filter((_, i) => i !== index))
  }

  const updateAttr = (index: number, value: string) => {
    onChange(attributes.map((a, i) => (i === index ? value : a)))
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl">
      <div className="text-xs text-muted-foreground mb-1">
        支持 Kether 模板语法，如：物理攻击: +{"{{ orryx level }}"}
      </div>

      <div className="space-y-1">
        {attributes.map((attr, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <input
              className="flex-1 bg-muted border border-border rounded px-3 py-1.5 text-sm font-mono"
              value={attr}
              onChange={(e) => updateAttr(i, e.target.value)}
            />
            <button
              onClick={() => removeAttr(i)}
              className="text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 shrink-0"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-muted border border-border rounded px-3 py-1.5 text-sm"
          value={newAttr}
          onChange={(e) => setNewAttr(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAttr()}
          placeholder="属性名: +值"
        />
        <button
          onClick={addAttr}
          disabled={!newAttr.trim()}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          添加
        </button>
      </div>
    </div>
  )
}

// ---- 脚本面板 ----
function ScriptsPanel({ options, onChange }: { options: JobOptions; onChange: (p: Partial<JobOptions>) => void }) {
  const scripts: { key: keyof JobOptions; label: string; desc: string }[] = [
    { key: "RegainManaActions", label: "法力回复", desc: "每次回复的法力值（Kether 脚本，返回数值）" },
    { key: "MaxManaActions", label: "最大法力", desc: "法力上限（Kether 脚本，返回数值）" },
    { key: "RegainSpiritActions", label: "精力回复", desc: "每次回复的精力值（Kether 脚本，返回数值）" },
    { key: "MaxSpiritActions", label: "最大精力", desc: "精力上限（Kether 脚本，返回数值）" },
    { key: "UpgradePointActions", label: "升级技能点", desc: "每次升级获得的技能点（Kether 脚本，返回数值）" },
  ]

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      {scripts.map(({ key, label, desc }) => (
        <div key={key}>
          <div className="mb-1">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground ml-2">{desc}</span>
          </div>
          <ActionsEditor
            value={(options[key] as string) ?? ""}
            onChange={(v) => onChange({ [key]: v })}
            height="80px"
          />
        </div>
      ))}
    </div>
  )
}

// ---- 通用字段组件 ----
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}
