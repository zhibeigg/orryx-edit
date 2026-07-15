import type { SyntheticEvent } from "react"

export const NODE_CONTROL_CLASS = "nodrag nowheel nopan"

export function stopNodeInteraction(event: SyntheticEvent): void {
  event.stopPropagation()
}
