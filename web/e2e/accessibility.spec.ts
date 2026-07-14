import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([])
}

test("插件门户首页在所有视口保持可读和可操作", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /不用想象.*真实技能/ })).toBeVisible()
  await expect(page.getByRole("figure", { name: /Orryx Editor 技能编辑工作区实景/ })).toBeVisible()
  await expect(page.getByRole("figure", { name: /Orryx 中心.*真实运行链路示例/ })).toBeVisible()
  await expect(page.getByRole("link", { name: "创建账户" }).first()).toHaveAttribute("href", "/register")
  await expect(page.getByText("/orryx edit").first()).toBeVisible()
  await expectNoPageOverflow(page)
  await expectNoSeriousAxeViolations(page)
})

test("独立注册页使用账户表单并链接回 Portal", async ({ page }) => {
  await page.goto("/register")
  await expect(page.getByRole("heading", { name: "创建 Orryx 账户" })).toBeVisible()
  await page.getByLabel("显示名称").focus()
  await expect(page.getByLabel("显示名称")).toBeFocused()
  await expect(page.getByRole("link", { name: "登录 Portal" })).toHaveAttribute("href", "/portal")
  await expectNoPageOverflow(page)
  await expectNoSeriousAxeViolations(page)
})

test("连接页清除 Fragment token 且不保留凭据", async ({ page }) => {
  await page.goto("/connect#token=e2e-token-not-registered")
  await expect(page).toHaveURL(/\/connect$/)
  await expect(page.getByRole("heading", { name: "连接 Orryx Editor" })).toBeVisible()
  await expectNoPageOverflow(page)
  await expectNoSeriousAxeViolations(page)
})

test("旧根路径 token 链接迁移到独立连接页", async ({ page }) => {
  await page.goto("/#token=e2e-legacy-token")
  await expect(page).toHaveURL(/\/connect$/)
  await expect(page.getByRole("heading", { name: "连接 Orryx Editor" })).toBeVisible()
  await expect(page.url()).not.toContain("token=")
})

test("查询参数 token 被拒绝并从地址栏移除", async ({ page }) => {
  await page.goto("/connect?token=e2e-unsafe-token")
  await expect(page).toHaveURL(/\/connect$/)
  await expect(page.getByRole("alert")).toContainText("已拒绝查询参数中的 Token")
  await expect(page.url()).not.toContain("token=")
  await expectNoPageOverflow(page)
})

test("Admin 可认证并在所有视口保持可用", async ({ page }) => {
  const adminKey = process.env.E2E_ADMIN_KEY ?? "0123456789abcdef"
  await page.goto("/admin")
  await page.getByLabel("Admin Key").fill(adminKey)
  await page.getByRole("button", { name: "登录管理后台" }).click()
  await expect(page.getByRole("heading", { name: "License 管理" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "在线更新" })).toBeVisible()
  await expectNoPageOverflow(page)
  await expectNoSeriousAxeViolations(page)
})

test("Portal 登录表单保持键盘和移动端语义", async ({ page }) => {
  await page.goto("/portal")
  await expect(page.getByRole("heading", { name: "Orryx 账户控制台" })).toBeVisible()
  await page.getByLabel("邮箱").focus()
  await expect(page.getByLabel("邮箱")).toBeFocused()
  await expect(page.getByRole("link", { name: "创建 Orryx 账户" })).toHaveAttribute("href", "/register")
  await expect(page.getByLabel("License Key")).toHaveCount(0)
  await expect(page.getByText("旧 License 门户")).toHaveCount(0)
  await expectNoPageOverflow(page)
})
