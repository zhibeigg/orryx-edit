import type { ReactNode } from "react"

interface YamlVisualGuardProps {
  error?: string
  children: ReactNode
}

/** 在 YAML 无法安全投影时停用局部可视化编辑，源码标签仍保持可用。 */
export function YamlVisualGuard({ error, children }: YamlVisualGuardProps) {
  if (!error) return children

  return (
    <div className="m-4 max-w-2xl rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
      <div className="font-medium text-red-300">暂时无法使用可视化编辑</div>
      <div className="mt-1 break-words text-red-200/90">{error}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        请切换到“YAML 源码”修复内容。原始源码会保持不变，不会被可视化编辑器的回退内容覆盖。
      </div>
    </div>
  )
}
