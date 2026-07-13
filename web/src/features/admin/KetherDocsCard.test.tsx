import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { KetherDocsCard } from "./KetherDocsCard"

describe("KetherDocsCard", () => {
  it("renders stable synchronization status and session adoption guidance", () => {
    const markup = renderToStaticMarkup(<KetherDocsCard adminKey="test-admin-key" />)
    expect(markup).toContain("Kether 文档同步")
    expect(markup).toContain("Orryx 版本")
    expect(markup).toContain("Schema 契约")
    expect(markup).toContain("完整性")
    expect(markup).toContain("立即同步 stable")
    expect(markup).toContain("已打开的会话不会在中途切换")
  })
})
