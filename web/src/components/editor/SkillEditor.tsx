import { useMemo, useCallback, useRef, useEffect } from "react"
import type { SkillData, SkillOptions } from "@/types"
import { parseYaml, updateYamlFromObject, stringifyYaml } from "@/lib/yaml-parser"
import { OptionsPanel } from "./OptionsPanel"
import { VariablesEditor } from "./VariablesEditor"
import { DescriptionEditor } from "./DescriptionEditor"
import { ActionsEditor } from "./ActionsEditor"
import { CrossRefPanel } from "./CrossRefPanel"
import { SkillTimeline } from "@/components/visualizer/SkillTimeline"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import Editor from "@monaco-editor/react"

interface SkillEditorProps {
  content: string
  onChange: (yamlContent: string) => void
  filePath?: string
}

export function SkillEditor({ content, onChange, filePath }: SkillEditorProps) {
  // 保留原始 YAML 文本用于注释保留的增量更新
  const rawYamlRef = useRef(content)
  useEffect(() => {
    rawYamlRef.current = content
  }, [content])

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

  return (
    <Tabs defaultValue="options" className="h-full flex flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="options">基础选项</TabsTrigger>
        <TabsTrigger value="variables">变量</TabsTrigger>
        <TabsTrigger value="description">描述</TabsTrigger>
        <TabsTrigger value="actions">Actions 脚本</TabsTrigger>
        <TabsTrigger value="timeline">时间轴</TabsTrigger>
        <TabsTrigger value="refs">引用</TabsTrigger>
        <TabsTrigger value="yaml">YAML 源码</TabsTrigger>
      </TabsList>

      <TabsContent value="options" className="flex-1 overflow-y-auto">
        <OptionsPanel
          options={skill.Options}
          onChange={(options: SkillOptions) => updateSkill((s) => ({ ...s, Options: options }))}
        />
      </TabsContent>

      <TabsContent value="variables" className="flex-1 overflow-y-auto">
        <VariablesEditor
          variables={skill.Options.Variables ?? {}}
          onChange={(variables) =>
            updateSkill((s) => ({ ...s, Options: { ...s.Options, Variables: variables } }))
          }
        />
      </TabsContent>

      <TabsContent value="description" className="flex-1 overflow-y-auto">
        <DescriptionEditor
          descriptions={skill.Options.Description ?? []}
          variables={skill.Options.Variables ?? {}}
          minLevel={skill.Options.MinLevel ?? 1}
          maxLevel={skill.Options.MaxLevel ?? 5}
          onChange={(descriptions) =>
            updateSkill((s) => ({ ...s, Options: { ...s.Options, Description: descriptions } }))
          }
        />
      </TabsContent>

      <TabsContent value="actions" className="flex-1 overflow-y-auto">
        <div className="h-full">
          <ActionsEditor
            value={skill.Actions ?? ""}
            onChange={(actions) => updateSkill((s) => ({ ...s, Actions: actions }))}
            height="100%"
          />
        </div>
      </TabsContent>

      <TabsContent value="timeline" className="flex-1 overflow-y-auto">
        <SkillTimeline script={skill.Actions ?? ""} />
      </TabsContent>

      <TabsContent value="refs" className="flex-1 overflow-y-auto">
        {filePath ? (
          <CrossRefPanel currentFile={filePath} />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            无法分析引用：未知文件路径。
          </div>
        )}
      </TabsContent>

      <TabsContent value="yaml" className="flex-1 overflow-y-auto">
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
      </TabsContent>
    </Tabs>
  )
}
