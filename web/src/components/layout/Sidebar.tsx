import { useState, useCallback, useRef, useEffect } from "react"
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw } from "lucide-react"
import type { FileTreeNode } from "@/types"
import { getConfigType } from "@/types"
import { useFileStore } from "@/store/file-store"
import { useEditorStore } from "@/store/editor-store"
import { wsClient } from "@/lib/ws-client"
import { tryRestoreDraft } from "@/lib/use-draft-sync"
import { cn } from "@/lib/utils"

// ---- 右键菜单 ----

interface ContextMenuState {
  x: number
  y: number
  node: FileTreeNode
}

function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { setFileTree, setLoading } = useFileStore()
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(state.node.name)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [createName, setCreateName] = useState("")

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  const refreshTree = async () => {
    setLoading(true)
    const res = await wsClient.fileList()
    setFileTree(res.files)
  }

  const handleDelete = async () => {
    if (!confirm(`确定删除 ${state.node.name}？`)) return
    try {
      await wsClient.fileDelete(state.node.path)
      // 如果文件已打开，关闭它
      useEditorStore.getState().closeFile(state.node.path)
      await refreshTree()
    } catch (err) {
      console.error("删除失败:", err)
    }
    onClose()
  }

  const handleRename = async () => {
    if (!newName.trim() || newName === state.node.name) {
      setRenaming(false)
      return
    }
    const parentPath = state.node.path.includes("/")
      ? state.node.path.substring(0, state.node.path.lastIndexOf("/"))
      : ""
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    try {
      await wsClient.fileRename(state.node.path, newPath)
      await refreshTree()
    } catch (err) {
      console.error("重命名失败:", err)
    }
    onClose()
  }

  const handleCreate = async () => {
    if (!createName.trim()) {
      setCreating(null)
      return
    }
    const basePath = state.node.isDirectory ? state.node.path : (
      state.node.path.includes("/")
        ? state.node.path.substring(0, state.node.path.lastIndexOf("/"))
        : ""
    )
    const newPath = basePath ? `${basePath}/${createName}` : createName
    try {
      await wsClient.fileCreate(newPath, creating === "folder")
      await refreshTree()
    } catch (err) {
      console.error("创建失败:", err)
    }
    onClose()
  }

  if (renaming) {
    return (
      <div ref={menuRef} className="fixed z-50 bg-popover border border-border rounded-md shadow-lg p-2" style={{ left: state.x, top: state.y }}>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") onClose() }}
          className="px-2 py-1 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring w-48"
        />
      </div>
    )
  }

  if (creating) {
    return (
      <div ref={menuRef} className="fixed z-50 bg-popover border border-border rounded-md shadow-lg p-2" style={{ left: state.x, top: state.y }}>
        <p className="text-xs text-muted-foreground mb-1">新建{creating === "file" ? "文件" : "文件夹"}</p>
        <input
          autoFocus
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose() }}
          placeholder={creating === "file" ? "文件名.yml" : "文件夹名"}
          className="px-2 py-1 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring w-48"
        />
      </div>
    )
  }

  return (
    <div ref={menuRef} className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]" style={{ left: state.x, top: state.y }}>
      <button onClick={() => setCreating("file")} className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent">新建文件</button>
      <button onClick={() => setCreating("folder")} className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent">新建文件夹</button>
      <div className="border-t border-border my-1" />
      <button onClick={() => { setRenaming(true); setNewName(state.node.name) }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent">重命名</button>
      <button onClick={handleDelete} className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent text-red-400">删除</button>
    </div>
  )
}

// ---- 树节点 ----

function TreeNode({ node, depth = 0, onContextMenu }: { node: FileTreeNode; depth?: number; onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const openFile = useEditorStore((s) => s.openFile)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)

  const handleClick = useCallback(async () => {
    if (node.isDirectory) {
      setExpanded((e) => !e)
      return
    }
    try {
      const res = await wsClient.fileRead(node.path)
      const { content, hasDraft } = await tryRestoreDraft(node.path, res.content)
      openFile({
        path: node.path,
        name: node.name,
        content: res.content,
        configType: getConfigType(node.path),
        ...(hasDraft ? { draft: content } : {}),
      })
    } catch (err) {
      console.error("读取文件失败:", err)
    }
  }, [node, openFile])

  const isActive = activeFilePath === node.path

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node) }}
        className={cn(
          "flex items-center w-full px-2 py-1 text-sm hover:bg-accent rounded-sm gap-1 text-left",
          isActive && !node.isDirectory && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDirectory ? (
          <>
            {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
            {expanded ? <FolderOpen className="w-4 h-4 shrink-0 text-yellow-500" /> : <Folder className="w-4 h-4 shrink-0 text-yellow-500" />}
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="w-4 h-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDirectory && expanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onContextMenu={onContextMenu} />
      ))}
    </div>
  )
}

// ---- Sidebar ----

export function Sidebar() {
  const { fileTree, loading, setFileTree, setLoading } = useFileStore()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileTreeNode) => {
    const x = Math.min(e.clientX, window.innerWidth - 160)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setContextMenu({ x, y, node })
  }, [])

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const res = await wsClient.fileList()
      setFileTree(res.files)
    } catch (err) {
      console.error("刷新文件树失败:", err)
      setLoading(false)
    }
  }

  return (
    <aside className="w-64 border-r border-border bg-sidebar-background flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sidebar-foreground">文件浏览器</h2>
        <button onClick={handleRefresh} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent" title="刷新">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">加载中...</div>
        ) : fileTree.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">暂无文件</div>
        ) : (
          fileTree.map((node) => <TreeNode key={node.path} node={node} onContextMenu={handleContextMenu} />)
        )}
      </div>
      {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
    </aside>
  )
}
