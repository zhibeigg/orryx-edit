import { useEffect, type SyntheticEvent } from "react"
import { useUpdateNodeInternals } from "@xyflow/react"

export const NODE_CONTROL_CLASS = "nodrag nowheel nopan"
export const NODE_PORT_SIZE_PX = 14
export const NODE_PORT_EDGE_OFFSET_PX = -(NODE_PORT_SIZE_PX / 2)

export function stopNodeInteraction(event: SyntheticEvent): void {
  event.stopPropagation()
}

/** Handle 数量或所在行变化后，通知 React Flow 重新测量端口与节点尺寸。 */
export function useNodeInternalsSync(nodeId: string, signature: string): void {
  const updateNodeInternals = useUpdateNodeInternals()

  useEffect(() => {
    updateNodeInternals(nodeId)
  }, [nodeId, signature, updateNodeInternals])
}
