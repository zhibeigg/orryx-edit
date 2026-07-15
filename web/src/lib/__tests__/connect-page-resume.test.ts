import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "../../pages/ConnectPage.tsx"), "utf8")

describe("ConnectPage 恢复失败处理", () => {
  it("只把永久认证错误标记为 resume 失效，SERVER_OFFLINE 保留刷新恢复路径", () => {
    expect(source).toContain("if (isPermanentAuthenticationError(resumeError))")
    expect(source).not.toMatch(/catch \(resumeError\)[\s\S]{0,120}wsClient\.clearResumeSession\(\)/)
    expect(source).toContain("请确认插件在线后刷新页面，或重新执行 /orryx edit")
  })

  it("重连耗尽通过 setAuthenticated(false) 清理 Zustand 伪认证", () => {
    const reconnectHandler = source.match(/wsClient\.setReconnectFailedHandler\([\s\S]*?wsClient\.setAuthenticationLostHandler/)
    expect(reconnectHandler?.[0]).toContain("setAuthenticated(false)")
    expect(reconnectHandler?.[0]).not.toContain("setReconnecting(false)")
  })

  it("重连耗尽后在未认证连接页展示明确错误", () => {
    expect(source).toContain("!resumeExpired && error")
    expect(source).toContain('role="alert"')
    expect(source).toContain("请刷新页面，或回到游戏重新执行 /orryx edit")
  })
})
