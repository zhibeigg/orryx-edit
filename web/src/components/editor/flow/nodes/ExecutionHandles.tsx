import { Handle, Position } from "@xyflow/react"

export function ExecutionHandles({ disabled }: { disabled: boolean }) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        id="flow-in"
        isConnectable={!disabled}
        style={{ background: "#94a3b8", width: 8, height: 8, top: 0, zIndex: 4 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="flow-out"
        isConnectable={!disabled}
        style={{ background: "#94a3b8", width: 8, height: 8, bottom: 0, zIndex: 4 }}
      />
    </>
  )
}
