import { X, Upload, Terminal, ChevronDown, ChevronUp, MoreHorizontal, Keyboard } from "lucide-react"
import { useState, useEffect } from "react"
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import type { OpenFile } from "@/store/editor-store"

type BottomPanel = "log" | null

interface EditorProps {
  content: string
  onChange: (value: string) => void
  filePath?: string
}

const configTypeEditors: Record<string, React.ComponentType<EditorProps>> = {
  skill: SkillEditor,
  station: StationEditor,
  status: StatusEditor,
  job: JobEditor,
  experience: ExperienceEditor,
}

const pathEditors: Record<string, React.ComponentType<EditorProps>> = {
  "bloom.yml": BloomEditor,
  "buffs.yml": BuffsEditor,
  "config.yml": ConfigEditor,
  "keys.yml": KeysEditor,
  "npc.yml": NpcEditor,
  "selectors.yml": SelectorsEditor,
  "state.yml": StateFileEditor,
}

function resolveEditor(file: OpenFile): React.ComponentType<EditorProps> {
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
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-4 p-8 rounded-xl bg-[var(--md-dark-bg-secondary)] shadow-lg" style={{ boxShadow: 'var(--md-elevation-2)' }}>
          <div className="w-16 h-16 mx-auto rounded-full bg-[var(--md-dark-bg-tertiary)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--md-dark-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--md-dark-text-primary)' }}>从左侧文件树选择一个文件开始编辑</p>
          <p className="text-sm" style={{ color: 'var(--md-dark-text-secondary)' }}>支持技能、职业、控制器、状态等配置文件</p>
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
    <div className="h-full flex flex-col" style={{ background: 'var(--md-dark-bg-primary)' }}>
      {/* 标签栏 - Material Design 风格 */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'var(--md-dark-border)', background: 'var(--md-dark-bg-secondary)' }}>
        <div className="flex-1 flex overflow-x-auto gap-1 p-1">
          {openFiles.map((file) => {
            const { icon: FileIcon, color: iconColor } = getFileIconInfo(file.path)
            const isActive = file.path === activeFilePath
            return (
              <div
                key={file.path}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer min-w-0 transition-all duration-[var(--md-transition-fast)]",
                  "rounded-lg relative overflow-hidden"
                )}
                style={{
                  background: isActive ? 'var(--md-dark-bg-primary)' : 'transparent',
                  boxShadow: isActive ? 'var(--md-elevation-1)' : 'none',
                  color: isActive ? 'var(--md-dark-text-primary)' : 'var(--md-dark-text-secondary)',
                }}
                onClick={() => setActiveFile(file.path)}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--md-dark-bg-tertiary)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                {isActive && (
                  <div 
                    className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-full"
                    style={{ background: 'var(--md-dark-accent-primary)' }}
                  />
                )}
                <FileIcon className={cn("w-4 h-4 shrink-0", iconColor)} />
                <span className="truncate max-w-[150px] font-medium">{file.name}</span>
                {file.dirty && (
                  <span 
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: 'var(--md-dark-accent-primary)' }}
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeFile(file.path)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity hover:bg-[var(--md-dark-bg-active)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        
        {/* 标签栏菜单 - Material Design 风格 */}
        <div className="flex items-center gap-1 px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--md-dark-text-secondary)] hover:bg-[var(--md-dark-bg-tertiary)] transition-colors"
                title="标签操作"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => closeSavedFiles()}>
                <span className="flex-1">关闭已保存</span>
                <kbd className="text-[10px] px-1.5 py-0.5 rounded ml-4" style={{ background: 'var(--md-dark-bg-tertiary)', color: 'var(--md-dark-text-muted)' }}>Ctrl+K U</kbd>
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
                <kbd className="text-[10px] px-1.5 py-0.5 rounded ml-4" style={{ background: 'var(--md-dark-bg-tertiary)', color: 'var(--md-dark-text-muted)' }}>Ctrl+K S</kbd>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => closeAllFiles()} className="text-[var(--md-dark-accent-error)]">
                <span className="flex-1">全部关闭</span>
                <kbd className="text-[10px] px-1.5 py-0.5 rounded ml-4" style={{ background: 'var(--md-dark-bg-tertiary)', color: 'var(--md-dark-text-muted)' }}>Ctrl+K W</kbd>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <button
            onClick={() => setShowPublish(!showPublish)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-all",
              !connected && "opacity-50"
            )}
            style={{
              background: showPublish ? 'var(--md-dark-bg-active)' : 'var(--md-dark-bg-tertiary)',
              color: showPublish ? 'var(--md-dark-text-primary)' : 'var(--md-dark-text-secondary)',
            }}
          >
            <Upload className="w-4 h-4" />
            <span className="font-medium">{connected ? "发布" : "离线"}</span>
            {dirtyCount > 0 && (
              <span 
                className="px-2 py-0.5 text-[10px] rounded-full font-semibold"
                style={{ background: 'var(--md-dark-accent-primary)', color: 'white' }}
              >
                {dirtyCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden">
            {renderEditor()}
          </div>
          
          {/* 发布面板侧边栏 - Material Design 卡片风格 */}
          {showPublish && (
            <div 
              className="w-80 overflow-y-auto shrink-0 flex flex-col"
              style={{ 
                background: 'var(--md-dark-bg-secondary)',
                borderLeft: '1px solid var(--md-dark-border)',
              }}
            >
              <div 
                className="m-3 rounded-xl overflow-hidden flex-1"
                style={{ 
                  background: 'var(--md-dark-bg-primary)',
                  boxShadow: 'var(--md-elevation-1)',
                }}
              >
                <PublishPanel />
              </div>
            </div>
          )}
        </div>

        {/* 底部面板 - Material Design 风格 */}
        {bottomPanel && (
          <div 
            className="h-56 shrink-0 flex flex-col"
            style={{ 
              borderTop: '1px solid var(--md-dark-border)',
              background: 'var(--md-dark-bg-primary)',
            }}
          >
            <div 
              className="flex items-center justify-between px-4 py-1 shrink-0"
              style={{ 
                borderBottom: '1px solid var(--md-dark-border)',
                background: 'var(--md-dark-bg-secondary)',
              }}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBottomPanel("log")}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-lg font-medium transition-all",
                    bottomPanel === "log" ? "text-[var(--md-dark-text-primary)]" : "text-[var(--md-dark-text-secondary)]"
                  )}
                  style={{
                    background: bottomPanel === "log" ? 'var(--md-dark-bg-active)' : 'transparent',
                  }}
                >
                  日志
                </button>
              </div>
              <button 
                onClick={() => setBottomPanel(null)} 
                className="p-1.5 rounded-lg hover:bg-[var(--md-dark-bg-tertiary)] transition-colors"
                style={{ color: 'var(--md-dark-text-secondary)' }}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {bottomPanel === "log" && <LogConsole />}
            </div>
          </div>
        )}
      </div>

      {/* 底部状态栏 - Material Design 风格 */}
      <div 
        className="h-7 flex items-center px-3 text-xs select-none shrink-0"
        style={{ background: 'var(--md-dark-accent-primary)' }}
      >
        <button
          onClick={() => setBottomPanel(bottomPanel === "log" ? null : "log")}
          className="flex items-center gap-2 px-2 py-1 rounded-md transition-colors font-medium"
          style={{ color: 'white' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>日志</span>
          {bottomPanel === null ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowShortcuts(true)}
          className="flex items-center gap-2 px-2 py-1 rounded-md transition-colors"
          style={{ color: 'rgba(255,255,255,0.9)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          title="快捷键 (Ctrl+/)"
        >
          <Keyboard className="w-3.5 h-3.5" />
        </button>
        {activeFile && (
          <span className="opacity-80 ml-2">{activeFile.path}</span>
        )}
      </div>

      {/* 快捷键面板 - Material Design 风格 */}
      <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
        <DialogContent className="w-[480px] max-h-[80vh]" style={{ background: 'var(--md-dark-bg-secondary)' }}>
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--md-dark-text-primary)' }}>快捷键</DialogTitle>
            <DialogDescription style={{ color: 'var(--md-dark-text-secondary)' }}>Ctrl+/ 打开/关闭此面板</DialogDescription>
          </DialogHeader>
          <div className="p-4 space-y-6 text-[13px] overflow-y-auto">
            <ShortcutSection title="文件操作">
              <ShortcutRow keys="Ctrl+S" desc="保存当前文件" />
              <ShortcutRow keys="Ctrl+Shift+S" desc="全部保存" />
            </ShortcutSection>
            <ShortcutSection title="标签页">
              <ShortcutRow keys="Ctrl+W" desc="关闭当前标签页" />
              <ShortcutRow keys="Ctrl+Shift+T" desc="重新打开最近关闭的标签页" />
              <ShortcutRow keys="Ctrl+Tab" desc="下一个标签页" />
              <ShortcutRow keys="Ctrl+Shift+Tab" desc="上一个标签页" />
              <ShortcutRow keys="Ctrl+1~9" desc="切换到第 N 个标签页" />
            </ShortcutSection>
            <ShortcutSection title="组合键 (Ctrl+K 前缀)">
              <ShortcutRow keys="Ctrl+K W" desc="全部关闭" />
              <ShortcutRow keys="Ctrl+K U" desc="关闭已保存" />
              <ShortcutRow keys="Ctrl+K S" desc="全部保存并关闭" />
            </ShortcutSection>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ShortcutSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p 
        className="text-[10px] uppercase tracking-wider font-semibold"
        style={{ color: 'var(--md-dark-accent-primary)' }}
      >
        {title}
      </p>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  )
}

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--md-dark-bg-tertiary)] transition-colors">
      <span style={{ color: 'var(--md-dark-text-primary)' }}>{desc}</span>
      <kbd 
        className="text-[11px] px-2 py-1 rounded-md font-mono"
        style={{ 
          background: 'var(--md-dark-bg-tertiary)',
          color: 'var(--md-dark-text-primary)',
          border: '1px solid var(--md-dark-border)',
        }}
      >
        {keys}
      </kbd>
    </div>
  )
}