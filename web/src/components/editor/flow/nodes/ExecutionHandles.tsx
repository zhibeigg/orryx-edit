import { Handle, Position } from "@xyflow/react"
import { NODE_PORT_EDGE_OFFSET_PX, NODE_PORT_SIZE_PX } from "./node-interaction"

export function ExecutionHandles({ disabled }: { disabled: boolean }) {
  const style = {
    background: "var(--ke-fg)",
    border: "2px solid var(--ke-bg-editor)",
    width: NODE_PORT_SIZE_PX,
    height: NODE_PORT_SIZE_PX,
    zIndex: 8,
  }

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        id="flow-in"
        isConnectable={!disabled}
        title="执行输入"
        style={{ ...style, top: NODE_PORT_EDGE_OFFSET_PX }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="flow-out"
        isConnectable={!disabled}
        title="执行输出"
        style={{ ...style, bottom: NODE_PORT_EDGE_OFFSET_PX }}
      />
    </>
  )
}
