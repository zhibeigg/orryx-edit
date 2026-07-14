import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), "utf8")

describe("前端路由隔离", () => {
  const app = source("../../App.tsx")
  const editorRoute = source("../../routes/EditorRoute.tsx")
  const authenticatedEditor = source("../../routes/AuthenticatedEditor.tsx")

  it("App 只懒加载并分发三个顶层路由", () => {
    expect(app).toContain('lazy(() => import("@/pages/AdminPage")')
    expect(app).toContain('lazy(() => import("@/pages/PortalPage")')
    expect(app).toContain('lazy(() => import("@/routes/EditorRoute")')
    expect(app).not.toMatch(/useDraftSync|useKeyboardShortcuts|useCrossRefLoader/)
    expect(app).not.toMatch(/Monaco|FlowEditor|three/)
  })

  it("未认证与窄屏路由不会静态导入编辑器 hooks 或重型页面", () => {
    expect(editorRoute).toContain('lazy(() => import("@/routes/AuthenticatedEditor")')
    expect(editorRoute).not.toMatch(/useDraftSync|useKeyboardShortcuts|useCrossRefLoader|@\/pages\/EditorPage/)
    expect(editorRoute).toContain("if (!authenticated) return <ConnectPage />")
    expect(editorRoute).toContain("if (narrow) return <NarrowEditorNotice />")
    expect(editorRoute).toContain("当前页面不会加载这些重型画布")
  })

  it("编辑器 hooks 与 EditorPage 只存在于认证后懒加载模块", () => {
    expect(authenticatedEditor).toMatch(/useDraftSync\(\)[\s\S]*useKeyboardShortcuts\(\)[\s\S]*useCrossRefLoader\(\)/)
    expect(authenticatedEditor).toContain('lazy(() => import("@/pages/EditorPage")')
  })
})

describe("登录表单语义", () => {
  it.each(["../../pages/AdminPage.tsx", "../../pages/PortalPage.tsx", "../../pages/ConnectPage.tsx"])("%s 使用真实表单和关联标签", (file) => {
    const page = source(file)
    expect(page).toContain("<form")
    expect(page).toMatch(/<label htmlFor=/)
    expect(page).toMatch(/<main id="main-content"/)
    expect(page).toMatch(/<h1/)
  })

  it("错误和账户加载状态具有可访问语义", () => {
    expect(source("../../pages/AdminPage.tsx")).toMatch(/role="alert"[^>]*aria-live="assertive"/)
    const portal = source("../../pages/PortalPage.tsx")
    expect(portal).toMatch(/role="alert"[^>]*aria-live="assertive"/)
    expect(portal).toContain('aria-busy={submitting}')
    expect(portal).toContain('aria-live="polite"')
  })
})
