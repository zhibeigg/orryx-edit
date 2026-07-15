import { Handle, Position } from "@xyflow/react"

export function ExecutionHandles({ disabled }: { disabled: boolean }) {
  const style = {
    background: "var(--ke-fg)",
    border: "2px solid var(--ke-bg-editor)",
    width: 10,
    height: 10,
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
        style={{ ...style, top: -5 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="flow-out"
        isConnectable={!disabled}
        title="执行输出"
        style={{ ...style, bottom: -5 }}
      />
    </>
  )
}
