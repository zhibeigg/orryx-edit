import { memo, useCallback, type DragEvent } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import type { SchemaAction } from "@/types/schema"

export const LoopNode = memo(function LoopNode({ id, data, selected }: NodeProps) {
  const d = data as KetherNodeData
  const bodyCount = d.slotChildren.body?.length ?? 0
  const { updateNodeData } = useReactFlow()

  const updateVariable = useCallback((value: string) => {
    d.onInlineEdit?.()
    updateNodeData(id, { inputs: { ...d.inputs, variable: value } })
  }, [id, d, updateNodeData])

  const handleBodyDrop = (event: DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData("application/kether-node")
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as SchemaAction | { builtin: string }
      d.onSlotDrop?.("body", payload)
    } catch {
      return
    }
  }

  return (
    <div className={`rounded-xl overflow-hidden min-w-[280px] border-2 border-orange-600 transition-all duration-200 ${selected ? "shadow-[0_0_0_2px_rgba(251,146,60,0.35),0_14px_28px_rgba(0,0,0,0.34)]" : "shadow-[0_10px_20px_rgba(0,0,0,0.25)]"}`}>
      <div className="px-3 py-1.5 bg-orange-600 text-[12px] font-medium text-white flex items-center gap-2">
        <span>for</span>
        <input type="text" value={String(d.inputs.variable ?? "i")}
          onChange={e => updateVariable(e.target.value)}
          className="w-14 px-1 py-0.5 text-[11px] bg-black/35 border border-white/10 rounded text-white font-mono focus:outline-none focus:ring-1 focus:ring-orange-300/70" />
        <span className="text-[10px] opacity-70">in</span>
        <Handle type="target" position={Position.Left} id="iterable"
          style={{ background: "#6b7280", width: 8, height: 8, left: -4 }} />
        <span className="text-[10px] opacity-70">{String(d.inputs.iterable ?? "")}</span>
      </div>

      {d.provides && Object.keys(d.provides).length > 0 && (
        <div className="bg-[#252526] px-2 py-0.5 text-[9px] text-green-400 border-b border-white/10">
          可用变量: {Object.keys(d.provides).map(k => `&${k}`).join(", ")}
        </div>
      )}

      <div className="bg-[#111318]">
        <div className="px-2 py-1 text-[10px] text-orange-400 uppercase tracking-wider">循环体 ({bodyCount})</div>
        <div
          className="min-h-[40px] px-2 py-1 bg-orange-900/10 border-l-2 border-orange-600 ml-2 mr-2 mb-1 rounded-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleBodyDrop}
        >
          {bodyCount === 0 && <div className="text-[10px] text-white/35 italic py-2 text-center">拖入节点...</div>}
        </div>
      </div>
    </div>
  )
})
