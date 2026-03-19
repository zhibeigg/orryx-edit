import { X, Upload, Terminal, ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react"
import { useState } from "react"
import { useEditorStore } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { getFileIconInfo } from "@/lib/file-icons"
import { YamlEditor } from "@/components/editor/YamlEditor"
import { SkillEditor } from "@/components/editor/SkillEditor"
import { JobEditor } from "@/components/editor/JobEditor"
import { StatusEditor } from "@/components/editor/StatusEditor"
import { StateFileEditor } from "@/components/editor/StateFileEditor"
import { StationEditor } from "@/components/editor/StationEditor"
import { ExperienceEditor } from "@/components/editor/ExperienceEditor"
import { PlaceholderEditor } from "@/components/editor/PlaceholderEditor"
import { BloomEditor } from "@/components/editor/BloomEditor"
import { BuffsEditor } from "@/components/editor/BuffsEditor"
import { ConfigEditor } from "@/components/editor/ConfigEditor"
import { KeysEditor } from "@/components/editor/KeysEditor"
import { NpcEditor } from "@/components/editor/NpcEditor"
import { SelectorsEditor } from "@/components/editor/SelectorsEditor"
import { PublishPanel } from "@/components/publish/PublishPanel"
import { LogConsole } from "@/components/visualizer/LogConsole"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import type { OpenFile } from "@/store/editor-store"

type BottomPanel = "log" | null

// 编辑器注册表 —— 新增编辑器只需在此添加映射
const configTypeEditors: Record<string, React.ComponentType<any>> = {
  skill: SkillEditor,
  station: StationEditor,
  status: StatusEditor,
  job: JobEditor,
  experience: ExperienceEditor,
}

const pathEditors: Record<string, React.ComponentType<any>> = {
  "bloom.yml": BloomEditor,
  "buffs.yml": BuffsEditor,
  "config.yml": ConfigEditor,
  "keys.yml": KeysEditor,
  "npc.yml": NpcEditor,
  "selectors.yml": SelectorsEditor,
  "state.yml": StateFileEditor,
}

function resolveEditor(file: OpenFile): React.ComponentType<any> {
  if (file.configType && configTypeEditors[file.configType]) {
    return configTypeEditors[file.configType]
  }
  if (file.path.startsWith("placeholders/")) {
    return PlaceholderEditor
  }
  return pathEditors[file.path] ?? YamlEditor
}

export function EditorPage() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, closeAllFiles, closeSavedFiles } = useEditorStore()
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
    const Editor = resolveEditor(activeFile)
    return <Editor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标签栏 */}
      <div className="flex border-b border-[#252526] bg-[#252526] shrink-0">
        <div className="flex-1 flex overflow-x-auto">
          {openFiles.map((file) => {
              const { icon: FileIcon, color: iconColor } = getFileIconInfo(file.path)
              return (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-1.5 px-3 py-[6px] text-[13px] border-r border-[#252526] cursor-pointer group min-w-0",
                file.path === activeFilePath
                  ? "bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]"
                  : "bg-[#2d2d2d] text-[#969696] hover:bg-[#2d2d2d]/80"
              )}
              onClick={() => setActiveFile(file.path)}
            >
              <FileIcon className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />
              <span className="truncate max-w-[150px]">{file.name}</span>
              {file.dirty && <span className="w-2 h-2 rounded-full bg-white/80 shrink-0" />}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(file.path)
                }}
                className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-[#3c3c3c] p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
              )
          })}
        </div>
        {/* 标签栏菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center px-2 py-[6px] text-[13px] border-l border-[#3c3c3c] hover:bg-[#2a2d2e] text-[#969696] shrink-0"
              title="标签操作"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => closeSavedFiles()}>
              <span className="flex-1">关闭已保存</span>
              <kbd className="text-[10px] text-[#858585] bg-[#2d2d2d] px-1.5 py-0.5 ml-4">Ctrl+K U</kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              const store = useEditorStore.getState()
              const { wsClient } = await import("@/lib/ws-client")
              for (const f of store.openFiles.filter(f => f.dirty)) {
                try {
                  const content = f.draft ?? f.content
                  await wsClient.fileWrite(f.path, content)
                  store.markSaved(f.path, content)
                } catch { /* skip */ }
              }
              store.closeAllFiles()
            }}>
              <span className="flex-1">全部保存并关闭</span>
              <kbd className="text-[10px] text-[#858585] bg-[#2d2d2d] px-1.5 py-0.5 ml-4">Ctrl+K S</kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => closeAllFiles()} className="text-[#f44747] hover:text-white">
              <span className="flex-1">全部关闭</span>
              <kbd className="text-[10px] text-[#858585] bg-[#2d2d2d] px-1.5 py-0.5 ml-4">Ctrl+K W</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => setShowPublish(!showPublish)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-[6px] text-[13px] border-l border-[#3c3c3c] hover:bg-[#2a2d2e] shrink-0 text-[#969696]",
            showPublish && "bg-[#37373d] text-white",
            !connected && "opacity-50"
          )}
        >
          <Upload className="w-3.5 h-3.5" />
          {connected ? "发布" : "离线"}
          {dirtyCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[#007acc] text-white rounded-sm">{dirtyCount}</span>
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

      {/* 底部状态栏 — VSCode 蓝色 */}
      <div className="h-[22px] bg-[#007acc] flex items-center px-2 text-[11px] text-white shrink-0 select-none">
        <button
          onClick={() => setBottomPanel(bottomPanel === "log" ? null : "log")}
          className="flex items-center gap-1 hover:bg-white/10 px-1"
        >
          <Terminal className="w-3 h-3" />
          日志
          {bottomPanel === null ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <div className="flex-1" />
        {activeFile && <span className="opacity-80">{activeFile.path}</span>}
      </div>
    </div>
  )
}
