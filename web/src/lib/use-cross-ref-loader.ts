import { useEffect, useRef } from "react"
import { useFileStore } from "@/store/file-store"
import { useEditorStore } from "@/store/editor-store"
import { useConnectionStore } from "@/store/connection-store"
import { wsClient } from "@/lib/ws-client"
import type { FileTreeNode } from "@/types"

/**
 * 后台批量加载 skills/ 和 stations/ 文件内容，用于交叉引用分析
 */
export function useCrossRefLoader() {
  const fileTree = useFileStore((s) => s.fileTree)
  const authenticated = useConnectionStore((s) => s.authenticated)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!authenticated || fileTree.length === 0 || loadedRef.current) return
    loadedRef.current = true

    const paths = collectYmlPaths(fileTree, ["skills/", "stations/", "status/"])
    if (paths.length === 0) return

    // 后台逐个加载，不阻塞 UI
    ;(async () => {
      const batch = new Map<string, string>()
      for (const path of paths) {
        try {
          const res = await wsClient.fileRead(path)
          batch.set(path, res.content)
        } catch {
          // 忽略单个文件读取失败
        }
      }
      if (batch.size > 0) {
        useEditorStore.getState().cacheFileContents(batch)
      }
    })()
  }, [authenticated, fileTree])

  // 认证断开时重置
  useEffect(() => {
    if (!authenticated) {
      loadedRef.current = false
    }
  }, [authenticated])
}

function collectYmlPaths(nodes: FileTreeNode[], prefixes: string[]): string[] {
  const paths: string[] = []
  function walk(node: FileTreeNode) {
    if (node.isDirectory) {
      node.children?.forEach(walk)
    } else if (node.name.endsWith(".yml") && prefixes.some(p => node.path.startsWith(p))) {
      paths.push(node.path)
    }
  }
  nodes.forEach(walk)
  return paths
}
