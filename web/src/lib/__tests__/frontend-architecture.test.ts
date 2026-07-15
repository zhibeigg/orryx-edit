import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), "utf8")

describe("前端路由隔离", () => {
  const app = source("../../App.tsx")
  const editorRoute = source("../../routes/EditorRoute.tsx")
  const authenticatedEditor = source("../../routes/AuthenticatedEditor.tsx")

  it("App 懒加载门户、注册、控制台、工作台和连接路由", () => {
    expect(app).toContain('lazy(() => import("@/pages/HomePage")')
    expect(app).toContain('lazy(() => import("@/pages/RegisterPage")')
    expect(app).toContain('lazy(() => import("@/pages/AdminPage")')
    expect(app).toContain('lazy(() => import("@/pages/PortalPage")')
    expect(app).toContain('lazy(() => import("@/routes/EditorRoute")')
    expect(app).not.toMatch(/useDraftSync|useKeyboardShortcuts|useCrossRefLoader/)
    expect(app).not.toMatch(/Monaco|FlowEditor|three/)
  })

  it("门户使用正式 Orryx 像素图标并同步浏览器图标", () => {
    const brandMark = source("../../components/BrandMark.tsx")
    const indexHtml = source("../../../index.html")
    expect(brandMark).toContain('import orryxMarkUrl from "@/assets/orryx.png"')
    expect(brandMark).toContain("src={orryxMarkUrl}")
    expect(brandMark).toContain('alt=""')
    expect(indexHtml).toContain('type="image/png" href="/src/assets/orryx.png"')
    expect(existsSync(resolve(__dirname, "../../assets/orryx.png"))).toBe(true)
  })

  it("旧根路径 Fragment 链接只迁移到独立连接路由", () => {
    const migration = source("../legacy-connection-link.ts")
    expect(app).toContain("migrateLegacyConnectionLink()")
    expect(migration).toContain('window.location.pathname !== "/"')
    expect(migration).toContain('window.location.replace(`/connect${window.location.hash}`)')
    expect(migration).not.toContain("searchParams.get")
  })

  it("未认证与窄屏路由不会静态导入编辑器 hooks 或重型页面", () => {
    expect(editorRoute).toContain('lazy(() => import("@/routes/AuthenticatedEditor")')
    expect(editorRoute).not.toMatch(/useDraftSync|useKeyboardShortcuts|useCrossRefLoader|@\/pages\/EditorPage/)
    expect(editorRoute).toContain("if (!authenticated || !workspaceId) return <ConnectPage />")
    expect(editorRoute).toContain("if (narrow) return <NarrowEditorNotice />")
    expect(editorRoute).toContain("当前页面不会加载这些重型画布")
  })

  it("编辑器 hooks 与 EditorPage 只存在于认证后懒加载模块", () => {
    expect(authenticatedEditor).toMatch(/useDraftSync\(workspaceId\)[\s\S]*useKeyboardShortcuts\(\)[\s\S]*useCrossRefLoader\(\)/)
    expect(authenticatedEditor).toContain('lazy(() => import("@/pages/EditorPage")')
  })
})

describe("账户与连接表单语义", () => {
  const accountForm = source("../../components/AccountAuthForm.tsx")
  const registerPage = source("../../pages/RegisterPage.tsx")
  const portalPage = source("../../pages/PortalPage.tsx")
  const connectPage = source("../../pages/ConnectPage.tsx")

  it.each(["../../pages/AdminPage.tsx", "../../components/AccountAuthForm.tsx", "../../pages/ConnectPage.tsx"])('%s 使用真实表单和关联标签', (file) => {
    const page = source(file)
    expect(page).toContain("<form")
    expect(page).toMatch(/<label htmlFor=/)
  })

  it("注册页与 Portal 复用固定模式账户表单", () => {
    expect(registerPage).toContain('<AccountAuthForm mode="register"')
    expect(portalPage).toContain('<AccountAuthForm mode="login"')
    expect(portalPage).toContain('href="/register"')
    expect(portalPage).not.toContain("auth-mode-switch")
    expect(portalPage).not.toContain("LegacyLicenseMigrationCard")
    expect(portalPage).not.toContain("/api/license/info")
  })

  it("错误、提交和加载状态具有可访问语义", () => {
    expect(source("../../pages/AdminPage.tsx")).toMatch(/role="alert"[^>]*aria-live="assertive"/)
    expect(accountForm).toMatch(/role="alert"[^>]*aria-live="assertive"/)
    expect(accountForm).toContain("aria-busy={submitting}")
    expect(registerPage).toContain('aria-live="polite"')
    expect(connectPage).toContain('aria-busy="true"')
    expect(connectPage).toContain('role="alert"')
  })
})
