import { useMemo, useCallback, useRef, useEffect } from "react"
import type { SkillData, SkillOptions } from "@/types"
import { safeParseYaml, updateYamlFromObject } from "@/lib/yaml-parser"
import { YamlVisualGuard } from "./YamlVisualGuard"
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

  const parsed = useMemo(() => safeParseYaml<SkillData>(content), [content])
  const skill = useMemo<SkillData>(() => parsed.ok
    ? { ...parsed.data, Options: parsed.data.Options ?? { Type: "DIRECT" } }
    : { Options: { Type: "DIRECT" } }, [parsed])

  // 使用保留注释的增量更新；无效 YAML 由可视化守卫阻止更新。
  const updateSkill = useCallback((updater: (s: SkillData) => SkillData) => {
    const updated = updater(skill)
    onChange(updateYamlFromObject(rawYamlRef.current, updated as unknown as Record<string, unknown>))
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
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <OptionsPanel options={skill.Options} onChange={(options: SkillOptions) => updateSkill((s) => ({ ...s, Options: options }))} />
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="variables" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <VariablesEditor variables={skill.Options.Variables ?? {}} onChange={(variables) =>
            updateSkill((s) => ({ ...s, Options: { ...s.Options, Variables: variables } }))} />
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="description" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <DescriptionEditor descriptions={skill.Options.Description ?? []} variables={skill.Options.Variables ?? {}}
            minLevel={skill.Options.MinLevel ?? 1} maxLevel={skill.Options.MaxLevel ?? 5} onChange={(descriptions) =>
              updateSkill((s) => ({ ...s, Options: { ...s.Options, Description: descriptions } }))} />
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="actions" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <div className="h-full">
            <ActionsEditor value={skill.Actions ?? ""} onChange={(actions) => updateSkill((s) => ({ ...s, Actions: actions }))} height="100%" />
          </div>
        </YamlVisualGuard>
      </TabsContent>

      <TabsContent value="timeline" className="flex-1 overflow-y-auto">
        <YamlVisualGuard error={parsed.ok ? undefined : parsed.error}>
          <SkillTimeline script={skill.Actions ?? ""} />
        </YamlVisualGuard>
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
