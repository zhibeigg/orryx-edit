import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react"
import type { FileTreeNode } from "@/types"
import { getConfigType } from "@/types"
import { getFileIconInfo, getFolderColor } from "@/lib/file-icons"
import { useFileStore } from "@/store/file-store"
import { useEditorStore } from "@/store/editor-store"
import { wsClient } from "@/lib/ws-client"
import { tryRestoreDraft } from "@/lib/use-draft-sync"
import { cn } from "@/lib/utils"
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// ---- 树节点 ----

function TreeNode({ node, depth = 0, onAction }: {
  node: FileTreeNode
  depth?: number
  onAction: (action: "newFile" | "newFolder" | "rename" | "delete", node: FileTreeNode) => void
}) {
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={handleClick}
            className={cn(
              "flex items-center w-full px-2 py-[3px] text-[13px] hover:bg-[#2a2d2e] gap-1 text-left cursor-pointer",
              isActive && !node.isDirectory && "bg-[#37373d]"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {node.isDirectory ? (
              <>
                {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                {expanded
                  ? <FolderOpen className={cn("w-4 h-4 shrink-0", getFolderColor(node.name))} />
                  : <Folder className={cn("w-4 h-4 shrink-0", getFolderColor(node.name))} />
                }
              </>
            ) : (() => {
              const { icon: Icon, color } = getFileIconInfo(node.path)
              return (
                <>
                  <span className="w-4" />
                  <Icon className={cn("w-4 h-4 shrink-0", color)} />
                </>
              )
            })()}
            <span className="truncate">{node.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onAction("newFile", node)}>
            <FilePlus className="w-3.5 h-3.5 mr-2" />新建文件
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("newFolder", node)}>
            <FolderPlus className="w-3.5 h-3.5 mr-2" />新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onAction("rename", node)}>
            <Pencil className="w-3.5 h-3.5 mr-2" />重命名
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction("delete", node)} className="text-[#f44747] focus:text-white">
            <Trash2 className="w-3.5 h-3.5 mr-2" />删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {node.isDirectory && expanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onAction={onAction} />
      ))}
    </div>
  )
}

// ---- Sidebar ----

export function Sidebar() {
  const { fileTree, loading, setFileTree, setLoading } = useFileStore()
  const [dialogState, setDialogState] = useState<{
    type: "rename" | "newFile" | "newFolder"
    node: FileTreeNode
  } | null>(null)
  const [inputValue, setInputValue] = useState("")

  const refreshTree = useCallback(async () => {
    setLoading(true)
    try {
      const res = await wsClient.fileList()
      setFileTree(res.files)
    } catch (err) {
      console.error("刷新文件树失败:", err)
      setLoading(false)
    }
  }, [setLoading, setFileTree])

  const handleAction = useCallback((action: "newFile" | "newFolder" | "rename" | "delete", node: FileTreeNode) => {
    if (action === "delete") {
      if (!confirm(`确定删除 ${node.name}？`)) return
      wsClient.fileDelete(node.path).then(() => {
        useEditorStore.getState().closeFile(node.path)
        refreshTree()
      }).catch((err) => console.error("删除失败:", err))
      return
    }
    setInputValue(action === "rename" ? node.name : "")
    setDialogState({ type: action, node })
  }, [refreshTree])

  const handleDialogSubmit = async () => {
    if (!dialogState || !inputValue.trim()) return
    const { type, node } = dialogState

    if (type === "rename") {
      const parentPath = node.path.includes("/")
        ? node.path.substring(0, node.path.lastIndexOf("/"))
        : ""
      const newPath = parentPath ? `${parentPath}/${inputValue}` : inputValue
      try {
        await wsClient.fileRename(node.path, newPath)
        await refreshTree()
      } catch (err) {
        console.error("重命名失败:", err)
      }
    } else {
      const basePath = node.isDirectory ? node.path : (
        node.path.includes("/")
          ? node.path.substring(0, node.path.lastIndexOf("/"))
          : ""
      )
      const newPath = basePath ? `${basePath}/${inputValue}` : inputValue
      try {
        await wsClient.fileCreate(newPath, type === "newFolder")
        await refreshTree()
      } catch (err) {
        console.error("创建失败:", err)
      }
    }
    setDialogState(null)
  }

  const dialogTitle = dialogState?.type === "rename" ? "重命名" : dialogState?.type === "newFile" ? "新建文件" : "新建文件夹"
  const dialogPlaceholder = dialogState?.type === "rename" ? "新名称" : dialogState?.type === "newFile" ? "文件名.yml" : "文件夹名"

  return (
    <aside className="w-64 border-r border-border bg-sidebar-background flex flex-col shrink-0">
      <div className="px-2 py-1 border-b border-border flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground">文件浏览器</h2>
        <button onClick={refreshTree} className="text-muted-foreground hover:text-foreground p-0.5 hover:bg-[#2a2d2e]" title="刷新">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">加载中...</div>
        ) : fileTree.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">暂无文件</div>
        ) : (
          fileTree.map((node) => <TreeNode key={node.path} node={node} onAction={handleAction} />)
        )}
      </div>

      <Dialog open={!!dialogState} onOpenChange={(open) => { if (!open) setDialogState(null) }}>
        <DialogContent className="w-80 p-0">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDialogSubmit(); if (e.key === "Escape") setDialogState(null) }}
              placeholder={dialogPlaceholder}
              className="w-full px-2 py-1.5 text-[13px] bg-[#3c3c3c] border border-[#3c3c3c] text-[#cccccc] focus:outline-none focus:border-[#007acc]"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setDialogState(null)} className="px-3 py-1 text-[13px] text-[#858585] hover:text-[#cccccc]">取消</button>
              <button onClick={handleDialogSubmit} disabled={!inputValue.trim()} className="px-3 py-1 text-[13px] bg-[#007acc] text-white hover:bg-[#0098ff] disabled:opacity-40">确认</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
