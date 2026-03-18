import { X, Upload, Terminal, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import { useEditorStore } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { YamlEditor } from "@/components/editor/YamlEditor"
import { SkillEditor } from "@/components/editor/SkillEditor"
import { JobEditor } from "@/components/editor/JobEditor"
import { StationEditor } from "@/components/editor/StationEditor"
import { PublishPanel } from "@/components/publish/PublishPanel"
import { LogConsole } from "@/components/visualizer/LogConsole"
import { cn } from "@/lib/utils"

type BottomPanel = "log" | null

export function EditorPage() {
  const { openFiles, activeFilePath, setActiveFile, closeFile } = useEditorStore()
  const connected = useConnectionStore((s) => s.connected)
  const [showPublish, setShowPublish] = useState(false)
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
  const dirtyCount = openFiles.filter((f) => f.dirty).length

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-lg">从左侧文件树选择一个文件开始编辑</p>
          <p className="text-sm">支持技能、职业、控制器、状态等配置文件</p>
        </div>
      </div>
    )
  }

  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  const renderEditor = () => {
    if (!activeFile) return null
    const content = activeFile.draft ?? activeFile.content
    const handleChange = (value: string) => useEditorStore.getState().updateDraft(activeFile.path, value)

    if (activeFile.configType === "skill") {
      return <SkillEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.configType === "station") {
      return <StationEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.configType === "job") {
      return <JobEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.path.startsWith("placeholders/")) {
      return <PlaceholderEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    return <YamlEditor key={activeFile.path} content={content} onChange={handleChange} />
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标签栏 */}
      <div className="flex border-b border-border bg-background shrink-0">
        <div className="flex-1 flex overflow-x-auto">
          {openFiles.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-1 px-3 py-2 text-sm border-r border-border cursor-pointer hover:bg-accent group min-w-0",
                file.path === activeFilePath && "bg-accent text-accent-foreground"
              )}
              onClick={() => setActiveFile(file.path)}
            >
              <span className="truncate max-w-[150px]">{file.name}</span>
              {file.dirty && <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(file.path)
                }}
                className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-secondary rounded p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowPublish(!showPublish)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-sm border-l border-border hover:bg-accent shrink-0",
            showPublish && "bg-accent",
            !connected && "opacity-50"
          )}
        >
          <Upload className="w-4 h-4" />
          {connected ? "发布" : "离线"}
          {dirtyCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-yellow-500 text-black rounded-full">{dirtyCount}</span>
          )}
        </button>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden">
            {renderEditor()}
          </div>
          {showPublish && (
            <div className="w-80 border-l border-border overflow-y-auto shrink-0">
              <PublishPanel />
            </div>
          )}
        </div>

        {/* 底部面板 */}
        {bottomPanel && (
          <div className="h-56 border-t border-border shrink-0 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 border-b border-border bg-background shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBottomPanel("log")}
                  className={cn("text-xs px-2 py-0.5 rounded", bottomPanel === "log" ? "bg-accent text-accent-foreground" : "text-muted-foreground")}
                >
                  日志
                </button>
              </div>
              <button onClick={() => setBottomPanel(null)} className="text-muted-foreground hover:text-foreground p-0.5">
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {bottomPanel === "log" && <LogConsole />}
            </div>
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="h-6 border-t border-border bg-background flex items-center px-3 text-xs text-muted-foreground shrink-0">
        <button
          onClick={() => setBottomPanel(bottomPanel === "log" ? null : "log")}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <Terminal className="w-3 h-3" />
          日志
          {bottomPanel === null ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <div className="flex-1" />
        {activeFile && <span>{activeFile.path}</span>}
      </div>
    </div>
  )
}
