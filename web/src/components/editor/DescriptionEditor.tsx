import { Plus, Trash2, GripVertical } from "lucide-react"

interface DescriptionEditorProps {
  descriptions: string[]
  onChange: (descriptions: string[]) => void
}

export function DescriptionEditor({ descriptions, onChange }: DescriptionEditorProps) {
  const updateLine = (index: number, value: string) => {
    const newDescs = [...descriptions]
    newDescs[index] = value
    onChange(newDescs)
  }

  const addLine = () => {
    onChange([...descriptions, ""])
  }

  const removeLine = (index: number) => {
    onChange(descriptions.filter((_, i) => i !== index))
  }

  const moveLine = (from: number, to: number) => {
    if (to < 0 || to >= descriptions.length) return
    const newDescs = [...descriptions]
    const [item] = newDescs.splice(from, 1)
    newDescs.splice(to, 0, item)
    onChange(newDescs)
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">描述 (Description)</h3>
        <button onClick={addLine} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="w-3.5 h-3.5" /> 添加行
        </button>
      </div>

      <div className="space-y-1.5">
        {descriptions.map((line, index) => (
          <div key={index} className="flex items-center gap-1.5 group">
            <div className="flex flex-col">
              <button
                onClick={() => moveLine(index, index - 1)}
                className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 p-0.5"
                disabled={index === 0}
              >
                <GripVertical className="w-3 h-3" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{index}</span>
            <input
              value={line}
              onChange={(e) => updateLine(index, e.target.value)}
              className="flex-1 px-2 py-1 text-sm bg-secondary border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              placeholder="描述行..."
            />
            {/* 高亮 {{ }} 模板语法的预览 */}
            {line.includes("{{") && (
              <span className="text-xs text-yellow-500 shrink-0">模板</span>
            )}
            {line.startsWith("*") && (
              <span className="text-xs text-blue-400 shrink-0">二级</span>
            )}
            <button onClick={() => removeLine(index)} className="text-muted-foreground hover:text-red-400 p-1 opacity-0 group-hover:opacity-100">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {descriptions.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无描述</p>
        )}
      </div>
    </div>
  )
}
