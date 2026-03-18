import { useState, useMemo, useCallback, useRef, lazy, Suspense } from "react"
import type { SkillData, SkillOptions } from "@/types"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { OptionsPanel } from "./OptionsPanel"
import { VariablesEditor } from "./VariablesEditor"
import { DescriptionEditor } from "./DescriptionEditor"
import { ActionsEditor } from "./ActionsEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { SkillTimeline } from "@/components/visualizer/SkillTimeline"
import { cn } from "@/lib/utils"
import { parseColliderFromScript } from "@/lib/collider-parser"
import Editor from "@monaco-editor/react"

const ColliderPreview = lazy(() =>
  import("@/components/visualizer/ColliderPreview").then((m) => ({ default: m.ColliderPreview }))
)

interface SkillEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

type Tab = "options" | "variables" | "description" | "actions" | "timeline" | "collider" | "refs" | "yaml"

export function SkillEditor({ content, onChange, filePath }: SkillEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>("options")
  // 保留原始 YAML 文本用于注释保留的增量更新
  const rawYamlRef = useRef(content)
  rawYamlRef.current = content

  const skill = useMemo<SkillData>(() => {
    try {
      return parseYaml<SkillData>(content)
    } catch {
      return { Options: { Type: "DIRECT" } }
    }
  }, [content])

  // 使用保留注释的增量更新
  const updateSkill = useCallback((updater: (s: SkillData) => SkillData) => {
    const updated = updater(skill)
    try {
      const newYaml = updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>)
      onChange(newYaml)
    } catch {
      onChange(stringifyYaml(updated))
    }
  }, [skill, onChange])

  const collider = useMemo(() => parseColliderFromScript(skill.Actions ?? ""), [skill.Actions])

  const tabs: { id: Tab; label: string }[] = [
    { id: "options", label: "基础选项" },
    { id: "variables", label: "变量" },
    { id: "description", label: "描述" },
    { id: "actions", label: "Actions 脚本" },
    { id: "timeline", label: "时间轴" },
    { id: "collider", label: "碰撞箱" },
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

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto">
          {activeTab === "options" && (
            <OptionsPanel
              options={skill.Options}
              onChange={(options: SkillOptions) => updateSkill((s) => ({ ...s, Options: options }))}
            />
          )}

          {activeTab === "variables" && (
            <VariablesEditor
              variables={skill.Options.Variables ?? {}}
              onChange={(variables) =>
                updateSkill((s) => ({ ...s, Options: { ...s.Options, Variables: variables } }))
              }
            />
          )}

          {activeTab === "description" && (
            <DescriptionEditor
              descriptions={skill.Options.Description ?? []}
              onChange={(descriptions) =>
                updateSkill((s) => ({ ...s, Options: { ...s.Options, Description: descriptions } }))
              }
            />
          )}

          {activeTab === "actions" && (
            <div className="h-full">
              <ActionsEditor
                value={skill.Actions ?? ""}
                onChange={(actions) => updateSkill((s) => ({ ...s, Actions: actions }))}
                height="100%"
              />
            </div>
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

          {activeTab === "timeline" && (
            <SkillTimeline script={skill.Actions ?? ""} />
          )}

          {activeTab === "collider" && collider && (
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">加载 3D 预览...</div>}>
              <ColliderPreview type={collider.type} params={collider.params} />
            </Suspense>
          )}

          {activeTab === "collider" && !collider && (
            <div className="p-4 text-sm text-muted-foreground">
              未在 Actions 脚本中检测到碰撞箱选择器（@range / @obb / @sector）。
            </div>
          )}

          {activeTab === "refs" && filePath && (
            <CrossRefPanel currentFile={filePath} />
          )}
          {activeTab === "refs" && !filePath && (
            <div className="p-4 text-sm text-muted-foreground">
              无法分析引用：未知文件路径。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
