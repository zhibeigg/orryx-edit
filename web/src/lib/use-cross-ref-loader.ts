import { useEffect, useRef } from "react"
import { useFileStore } from "@/store/file-store"
import { useEditorStore } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { wsClient } from "@/lib/ws-client"
import type { FileTreeNode } from "@/types"

/** 后台批量加载 skills/、stations/ 与 status/ 文件内容，用于交叉引用分析。 */
export function useCrossRefLoader() {
  const fileTree = useFileStore((state) => state.fileTree)
  const authenticated = useConnectionStore((state) => state.authenticated)
  const workspaceId = useConnectionStore((state) => state.workspaceId)
  const loadedWorkspaceRef = useRef<string | null>(null)

  useEffect(() => {
    if (!authenticated || !workspaceId || fileTree.length === 0 || loadedWorkspaceRef.current === workspaceId) return
    loadedWorkspaceRef.current = workspaceId

    const paths = collectYmlPaths(fileTree, ["skills/", "stations/", "status/"])
    if (paths.length === 0) return

    ;(async () => {
      const batch = new Map<string, string>()
      for (const path of paths) {
        if (useConnectionStore.getState().workspaceId !== workspaceId) return
        try {
          const response = await wsClient.fileRead(path)
          batch.set(path, response.content)
        } catch {
          // 忽略单个文件读取失败
        }
      }
      if (batch.size > 0) {
        useEditorStore.getState().cacheFileContents(workspaceId, batch)
      }
    })()
  }, [authenticated, fileTree, workspaceId])

  useEffect(() => {
    if (!authenticated) loadedWorkspaceRef.current = null
  }, [authenticated])
}

function collectYmlPaths(nodes: FileTreeNode[], prefixes: string[]): string[] {
  const paths: string[] = []
  function walk(node: FileTreeNode) {
    if (node.isDirectory) {
      node.children?.forEach(walk)
    } else if (node.name.endsWith(".yml") && prefixes.some((prefix) => node.path.startsWith(prefix))) {
      paths.push(node.path)
    }
  }
  nodes.forEach(walk)
  return paths
}
