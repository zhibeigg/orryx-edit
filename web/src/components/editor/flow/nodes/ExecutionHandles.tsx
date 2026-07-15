import { Handle, Position } from "@xyflow/react"

export function ExecutionHandles({ disabled }: { disabled: boolean }) {
  const style = {
    background: "#d7c4a7",
    border: "2px solid #252018",
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
