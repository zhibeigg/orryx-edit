import { X, Upload, Terminal, ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react"
import { useState, useRef, useEffect } from "react"
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
import { cn } from "@/lib/utils"

type BottomPanel = "log" | null

export function EditorPage() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, closeAllFiles, closeSavedFiles } = useEditorStore()
  const connected = useConnectionStore((s) => s.connected)
  const [showPublish, setShowPublish] = useState(false)
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
  const [showTabMenu, setShowTabMenu] = useState(false)
  const tabMenuRef = useRef<HTMLDivElement>(null)
  const dirtyCount = openFiles.filter((f) => f.dirty).length

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setShowTabMenu(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

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

    if (activeFile.configType === "status") {
      return <StatusEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.configType === "job") {
      return <JobEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.configType === "experience") {
      return <ExperienceEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    if (activeFile.path.startsWith("placeholders/")) {
      return <PlaceholderEditor key={activeFile.path} content={content} onChange={handleChange} filePath={activeFile.path} />
    }

    // 单文件专用编辑器
    if (activeFile.path === "bloom.yml") {
      return <BloomEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "buffs.yml") {
      return <BuffsEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "config.yml") {
      return <ConfigEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "keys.yml") {
      return <KeysEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "npc.yml") {
      return <NpcEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "selectors.yml") {
      return <SelectorsEditor key={activeFile.path} content={content} onChange={handleChange} />
    }
    if (activeFile.path === "state.yml") {
      return <StateFileEditor key={activeFile.path} content={content} onChange={handleChange} />
    }

    return <YamlEditor key={activeFile.path} content={content} onChange={handleChange} />
  }

  return (
    <div className="h-full flex flex-col">
      {/* 标签栏 */}
      <div className="flex border-b border-border bg-background shrink-0">
        <div className="flex-1 flex overflow-x-auto">
          {openFiles.map((file) => {
              const { icon: FileIcon, color: iconColor } = getFileIconInfo(file.path)
              return (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-1 px-3 py-2 text-sm border-r border-border cursor-pointer hover:bg-accent group min-w-0",
                file.path === activeFilePath && "bg-accent text-accent-foreground"
              )}
              onClick={() => setActiveFile(file.path)}
            >
              <FileIcon className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />
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
              )
          })}
        </div>
        {/* 标签栏菜单 */}
        <div className="relative shrink-0" ref={tabMenuRef}>
          <button
            onClick={() => setShowTabMenu(!showTabMenu)}
            className="flex items-center px-2 py-2 text-sm border-l border-border hover:bg-accent"
            title="标签操作"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showTabMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]">
              <button
                onClick={() => { closeSavedFiles(); setShowTabMenu(false) }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center justify-between"
              >
                关闭已保存
                <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Ctrl+K U</kbd>
              </button>
              <button
                onClick={async () => {
                  // 全部保存再关闭
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
                  setShowTabMenu(false)
                }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent flex items-center justify-between"
              >
                全部保存并关闭
                <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Ctrl+K S</kbd>
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { closeAllFiles(); setShowTabMenu(false) }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent text-red-400 flex items-center justify-between"
              >
                全部关闭
                <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Ctrl+K W</kbd>
              </button>
            </div>
          )}
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
