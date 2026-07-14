import { describe, expect, it } from "vitest"
import { parseAppRoute, workbenchPath } from "@/lib/app-route"

describe("应用路由解析", () => {
  it("解析门户、注册、连接、Portal 与 Admin 顶层路由", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "home" })
    expect(parseAppRoute("/register/")).toEqual({ kind: "register" })
    expect(parseAppRoute("/connect")).toEqual({ kind: "connect" })
    expect(parseAppRoute("/portal")).toEqual({ kind: "portal" })
    expect(parseAppRoute("/admin/")).toEqual({ kind: "admin" })
  })

  it("解析并安全编码工作台路径", () => {
    const path = workbenchPath("workspace a", "server/encoded")
    expect(path).toBe("/workspaces/workspace%20a/servers/server%2Fencoded")
    expect(parseAppRoute(path)).toEqual({ kind: "workbench", workspaceId: "workspace a", serverInstanceId: "server/encoded" })
  })

  it("非法或未知路径回退插件门户", () => {
    expect(parseAppRoute("/workspaces/a/servers")).toEqual({ kind: "home" })
    expect(parseAppRoute("/workspaces/%E0%A4%A/servers/b")).toEqual({ kind: "home" })
    expect(parseAppRoute("/unknown")).toEqual({ kind: "home" })
  })
})
