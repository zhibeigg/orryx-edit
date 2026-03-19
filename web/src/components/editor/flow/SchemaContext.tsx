import { createContext, useContext } from "react"
import type { ActionsSchemaV2 } from "@/types/schema"

const SchemaContext = createContext<ActionsSchemaV2 | null>(null)

export const SchemaProvider = SchemaContext.Provider

export function useSchema(): ActionsSchemaV2 | null {
  return useContext(SchemaContext)
}
