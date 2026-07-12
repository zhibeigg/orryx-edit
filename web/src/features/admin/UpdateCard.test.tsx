import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { UpdateCard } from "./UpdateCard"

describe("UpdateCard", () => {
  it("renders update status fields and safe actions", () => {
    const markup = renderToStaticMarkup(<UpdateCard adminKey="test-admin-key" />)
    expect(markup).toContain("在线更新")
    expect(markup).toContain("当前版本")
    expect(markup).toContain("最新版本")
    expect(markup).toContain("部署方式")
    expect(markup).toContain("检查更新")
    expect(markup).toContain("下载并暂存")
  })
})
