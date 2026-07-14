import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { apiRequest } from "@/lib/api-client"

const originalFetch = globalThis.fetch
const originalDocument = globalThis.document

function setCookieSource(cookie: string) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  })
  vi.restoreAllMocks()
})

describe("API 会话与 CSRF", () => {
  it("所有请求使用 same-origin credentials，非 GET 携带 CSRF cookie", async () => {
    setCookieSource("theme=dark; orryx_csrf=csrf%20value")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    globalThis.fetch = fetchMock

    await apiRequest<{ ok: boolean }, { value: number }>("/api/v2/example", {
      method: "POST",
      body: { value: 1 },
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(init?.credentials).toBe("same-origin")
    expect(headers.get("X-CSRF-Token")).toBe("csrf value")
    expect(headers.get("Content-Type")).toBe("application/json")
  })

  it("GET 不发送 CSRF header，但仍使用 same-origin credentials", async () => {
    setCookieSource("orryx_csrf=csrf-token")
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    globalThis.fetch = fetchMock

    await apiRequest<{ ok: boolean }>("/api/v2/auth/me")

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.credentials).toBe("same-origin")
    expect(new Headers(init?.headers).has("X-CSRF-Token")).toBe(false)
  })

  it("账户会话实现不读写 localStorage 或 sessionStorage", () => {
    const files = ["../api-client.ts", "../account-api.ts", "../../pages/PortalPage.tsx"]
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8")
      expect(source).not.toMatch(/localStorage|sessionStorage/)
    }
  })
})
