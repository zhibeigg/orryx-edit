import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import type { KetherNodeData } from "../flow-types"
import { NODE_CONTROL_CLASS, stopNodeInteraction } from "./node-interaction"

export const RawNode = memo(function RawNode({ data, selected }: NodeProps) {
  const nodeData = data as KetherNodeData
  return (
    <div
      className={`kether-block kether-block--raw ${selected ? "is-selected" : ""} ${nodeData.readOnly ? "is-readonly" : ""}`}
      aria-label="Raw Kether block"
    >
      <div className="kether-block__header">
        <span>RAW KETHER</span>
        <span className="kether-block__variant">局部保真</span>
      </div>
      <textarea
        value={String(nodeData.inputs.source ?? nodeData.rawSource ?? "")}
        readOnly={Boolean(nodeData.readOnly)}
        rows={4}
        spellCheck={false}
        onPointerDown={stopNodeInteraction}
        onWheel={stopNodeInteraction}
        onChange={(event) => nodeData.onInputChange?.("source", event.target.value, "raw")}
        className={`${NODE_CONTROL_CLASS} kether-block__raw-editor`}
        aria-label="原始 Kether 文本"
      />
    </div>
  )
})
