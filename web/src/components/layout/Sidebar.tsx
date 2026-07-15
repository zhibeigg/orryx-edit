import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react"
import type { FileTreeNode } from "@/types"
import { getFileIconInfo, getFolderColor } from "@/lib/file-icons"
import { useFileStore } from "@/store/file-store"
import { useEditorStore } from "@/store/editor-store"
import { deleteServerPathSafely, renameServerPathSafely } from "@/lib/file-lifecycle"
import { openServerFile } from "@/lib/server-file"
import { wsClient } from "@/lib/ws-client"
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
  const activeFilePath = useEditorStore((s) => s.activeFilePath)

  const handleClick = useCallback(async () => {
    if (node.isDirectory) {
      setExpanded((e) => !e)
      return
    }
    try {
      await openServerFile(node.path, node.name)
    } catch (err) {
      console.error("读取文件失败:", err)
    }
  }, [node])

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
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationStatus, setOperationStatus] = useState<{ success: boolean; message: string } | null>(null)

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
    if (operationBusy) return
    if (action === "delete") {
      const consequence = node.isDirectory
        ? `确定删除目录 ${node.name} 及其全部子文件、已打开标签和本地草稿？`
        : `确定删除 ${node.name}、对应标签和本地草稿？`
      if (!confirm(consequence)) return
      setOperationBusy(true)
      setOperationStatus(null)
      void deleteServerPathSafely(node.path, node.isDirectory)
        .then(async (result) => {
          setOperationStatus({ success: result.success, message: result.message })
          if (result.changed) await refreshTree()
        })
        .catch((error) => {
          setOperationStatus({
            success: false,
            message: error instanceof Error ? error.message : "删除失败，远端文件未变更。",
          })
        })
        .finally(() => setOperationBusy(false))
      return
    }
    setOperationStatus(null)
    setInputValue(action === "rename" ? node.name : "")
    setDialogState({ type: action, node })
  }, [operationBusy, refreshTree])

  const handleDialogSubmit = async () => {
    if (!dialogState || !inputValue.trim() || operationBusy) return
    const { type, node } = dialogState
    setOperationBusy(true)
    setOperationStatus(null)

    try {
      if (type === "rename") {
        const parentPath = node.path.includes("/")
          ? node.path.substring(0, node.path.lastIndexOf("/"))
          : ""
        const newPath = parentPath ? `${parentPath}/${inputValue.trim()}` : inputValue.trim()
        const result = await renameServerPathSafely(node.path, newPath, node.isDirectory)
        setOperationStatus({ success: result.success, message: result.message })
        if (result.changed) await refreshTree()
        if (result.success) setDialogState(null)
      } else {
        const basePath = node.isDirectory ? node.path : (
          node.path.includes("/")
            ? node.path.substring(0, node.path.lastIndexOf("/"))
            : ""
        )
        const newPath = basePath ? `${basePath}/${inputValue.trim()}` : inputValue.trim()
        await wsClient.fileCreate(newPath, type === "newFolder")
        await refreshTree()
        setOperationStatus({ success: true, message: type === "newFolder" ? "文件夹已创建。" : "文件已创建。" })
        setDialogState(null)
      }
    } catch (error) {
      setOperationStatus({
        success: false,
        message: error instanceof Error ? error.message : "文件操作失败。",
      })
    } finally {
      setOperationBusy(false)
    }
  }

  const dialogTitle = dialogState?.type === "rename" ? "重命名" : dialogState?.type === "newFile" ? "新建文件" : "新建文件夹"
  const dialogPlaceholder = dialogState?.type === "rename" ? "新名称" : dialogState?.type === "newFile" ? "文件名.yml" : "文件夹名"

  return (
    <aside className="w-64 border-r border-border bg-sidebar-background flex flex-col shrink-0">
      <div className="px-2 py-1 border-b border-border flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground">文件浏览器</h2>
        <button onClick={refreshTree} disabled={operationBusy} className="text-muted-foreground hover:text-foreground p-0.5 hover:bg-[#2a2d2e] disabled:opacity-40" title="刷新">
          <RefreshCw className={cn("w-3.5 h-3.5", operationBusy && "animate-spin")} />
        </button>
      </div>
      {operationStatus && (
        <div
          role={operationStatus.success ? "status" : "alert"}
          className={cn(
            "border-b px-2 py-2 text-[11px] leading-4",
            operationStatus.success
              ? "border-emerald-700/50 bg-emerald-950/60 text-emerald-100"
              : "border-red-700/50 bg-red-950/60 text-red-100",
          )}
        >
          {operationStatus.message}
        </div>
      )}
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
              disabled={operationBusy}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDialogSubmit(); if (e.key === "Escape") setDialogState(null) }}
              placeholder={dialogPlaceholder}
              className="w-full px-2 py-1.5 text-[13px] bg-[#3c3c3c] border border-[#3c3c3c] text-[#cccccc] focus:outline-none focus:border-[#007acc]"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setDialogState(null)} disabled={operationBusy} className="px-3 py-1 text-[13px] text-[#858585] hover:text-[#cccccc] disabled:opacity-40">取消</button>
              <button onClick={handleDialogSubmit} disabled={!inputValue.trim() || operationBusy} className="px-3 py-1 text-[13px] bg-[#007acc] text-white hover:bg-[#0098ff] disabled:opacity-40">{operationBusy ? "处理中..." : "确认"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
