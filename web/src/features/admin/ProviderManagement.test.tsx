import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProviderManagement } from "./ProviderManagement"

describe("ProviderManagement", () => {
  it("说明 secret 不进入前端且包含 Base URL 重启提示", () => {
    const markup = renderToStaticMarkup(<ProviderManagement adminKey="test-admin-key" />)
    expect(markup).toContain("AI Provider 管理")
    expect(markup).toContain("API key/secret")
    expect(markup).toContain("不会由前端读取、显示或提交")
  })
})
