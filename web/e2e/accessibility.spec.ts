import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test("连接页无严重无障碍问题且不会保留 URL token", async ({ page }) => {
  await page.goto("/#token=e2e-token-not-registered")
  await expect(page).toHaveURL(/^(?!.*token=)/)
  await expect(page.getByRole("heading", { name: "连接 Orryx Editor" })).toBeVisible()
  await expectNoPageOverflow(page)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([])
})

test("Admin 可认证并在所有视口保持可用", async ({ page }) => {
  const adminKey = process.env.E2E_ADMIN_KEY ?? "0123456789abcdef"
  await page.goto("/admin")
  await page.getByLabel("Admin Key").fill(adminKey)
  await page.getByRole("button", { name: "登录管理后台" }).click()
  await expect(page.getByRole("heading", { name: "License 管理" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "在线更新" })).toBeVisible()
  await expectNoPageOverflow(page)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([])
})

test("Portal 登录表单保持键盘和移动端语义", async ({ page }) => {
  await page.goto("/portal")
  await expect(page.getByRole("heading", { name: "License 门户" })).toBeVisible()
  await page.getByLabel("License Key").focus()
  await expect(page.getByLabel("License Key")).toBeFocused()
  await expectNoPageOverflow(page)
})
