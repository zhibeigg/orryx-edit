import { describe, expect, it } from "vitest"
import { parseAppRoute, workbenchPath } from "@/lib/app-route"

describe("应用路由解析", () => {
  it("保留 editor、portal 与 admin 顶层路由", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "editor" })
    expect(parseAppRoute("/portal")).toEqual({ kind: "portal" })
    expect(parseAppRoute("/admin/")).toEqual({ kind: "admin" })
  })

  it("解析并安全编码工作台路径", () => {
    const path = workbenchPath("workspace a", "server/encoded")
    expect(path).toBe("/workspaces/workspace%20a/servers/server%2Fencoded")
    expect(parseAppRoute(path)).toEqual({ kind: "workbench", workspaceId: "workspace a", serverInstanceId: "server/encoded" })
  })

  it("非法工作台路径回退编辑器", () => {
    expect(parseAppRoute("/workspaces/a/servers")).toEqual({ kind: "editor" })
    expect(parseAppRoute("/workspaces/%E0%A4%A/servers/b")).toEqual({ kind: "editor" })
  })
})
