import { useMemo } from "react"
import { useEditorStore } from "@/store/editor-store"
import {
  analyzeAllFiles,
  getCrossRefsForFile,
  refTypeLabel,
  refActionLabel,
  refActionColor,
  type RefGroup,
  type CrossRef,
} from "@/lib/cross-ref-analyzer"
import { getConfigType } from "@/types"
import { cn } from "@/lib/utils"

interface CrossRefPanelProps {
  currentFile: string
}

export function CrossRefPanel({ currentFile }: CrossRefPanelProps) {
  const fileContents = useEditorStore((s) => s.fileContents)
  const openFile = useEditorStore((s) => s.openFile)

  const groups = useMemo<RefGroup[]>(() => {
    if (fileContents.size === 0) return []
    const allRefs = analyzeAllFiles(fileContents)
    return getCrossRefsForFile(currentFile, allRefs)
  }, [fileContents, currentFile])

  if (fileContents.size === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        正在加载文件内容，请稍候...
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        未检测到与其他文件的交叉引用。
      </div>
    )
  }

  const handleClickFile = (ref: CrossRef) => {
    const content = fileContents.get(ref.file)
    if (!content) return
    const name = ref.file.split("/").pop() ?? ref.file
    openFile({ path: ref.file, name, content, configType: getConfigType(ref.file) })
  }

  // 按类型分组显示
  const typeGroups = new Map<string, RefGroup[]>()
  for (const g of groups) {
    const key = refTypeLabel(g.type)
    if (!typeGroups.has(key)) typeGroups.set(key, [])
    typeGroups.get(key)!.push(g)
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="text-xs text-muted-foreground mb-2">
        已扫描 {fileContents.size} 个文件，找到 {groups.length} 组交叉引用
      </div>

      {Array.from(typeGroups.entries()).map(([typeName, refGroups]) => (
        <div key={typeName}>
          <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            {typeName}
          </h3>

          <div className="space-y-2">
            {refGroups.map((group) => (
              <RefGroupCard
                key={`${group.type}:${group.name}`}
                group={group}
                currentFile={currentFile}
                onClickFile={handleClickFile}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RefGroupCard({
  group,
  currentFile,
  onClickFile,
}: {
  group: RefGroup
  currentFile: string
  onClickFile: (ref: CrossRef) => void
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="px-3 py-1.5 bg-muted/50 text-sm font-mono flex items-center gap-2">
        <span className="text-foreground">{group.name}</span>
        <span className="text-xs text-muted-foreground">({group.refs.length} 处引用)</span>
      </div>

      <div className="divide-y divide-border">
        {group.refs.map((ref, i) => {
          const isCurrent = ref.file === currentFile
          const shortPath = ref.file.replace(/\.yml$/, "")
          return (
            <div
              key={i}
              className={cn(
                "px-3 py-1.5 flex items-center gap-2 text-xs",
                isCurrent ? "bg-muted/30" : "hover:bg-muted/20 cursor-pointer"
              )}
              onClick={() => !isCurrent && onClickFile(ref)}
            >
              <span className={cn("w-10 shrink-0 font-medium", refActionColor(ref.action))}>
                {refActionLabel(ref.action)}
              </span>
              <span className={cn("shrink-0", isCurrent ? "text-foreground font-medium" : "text-blue-400 hover:underline")}>
                {shortPath}
              </span>
              <span className="text-muted-foreground">:{ref.line}</span>
              <span className="text-zinc-500 truncate ml-auto font-mono text-[11px] max-w-[300px]">
                {ref.snippet}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
