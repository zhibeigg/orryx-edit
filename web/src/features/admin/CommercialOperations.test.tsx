import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CommercialOperations } from "./CommercialOperations"

describe("CommercialOperations", () => {
  it("提供四类只读商业运维入口", () => {
    const markup = renderToStaticMarkup(<CommercialOperations adminKey="test-admin-key" />)
    expect(markup).toContain("商业运维")
    expect(markup).toContain("订单 0")
    expect(markup).toContain("钱包 0")
    expect(markup).toContain("AI Jobs 0")
    expect(markup).toContain("Releases 0")
    expect(markup).toContain("只读视图")
  })
})
