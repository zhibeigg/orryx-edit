import { afterEach, describe, expect, it, vi } from "vitest"
import { adminCommercialApi, providerUpdateDto, type AdminAiProvider } from "@/lib/admin-commercial-api"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("Admin commercial API", () => {
  it("保留模型价格但不包含 secret 或 API key 字段", () => {
    const provider = {
      id: "openai",
      providerType: "openai-compatible",
      displayName: "OpenAI",
      enabled: true,
      baseUrl: "https://example.invalid/v1",
      models: [{ id: "model-a", inputCentsPerMillion: 10, outputCentsPerMillion: 20, cachedInputCentsPerMillion: 5 }],
      defaultModel: "model-a",
      restartRequired: false,
      updatedAt: "2026-01-01T00:00:00Z",
      apiKey: "should-never-leak",
      secret: "should-never-leak",
    } as AdminAiProvider & { apiKey: string; secret: string }

    const dto = providerUpdateDto(provider)
    expect(dto).toEqual({
      displayName: "OpenAI",
      enabled: true,
      providerType: "openai-compatible",
      baseUrl: "https://example.invalid/v1",
      models: [{ id: "model-a", inputCentsPerMillion: 10, outputCentsPerMillion: 20, cachedInputCentsPerMillion: 5 }],
      defaultModel: "model-a",
    })
    expect(dto).not.toHaveProperty("apiKey")
    expect(dto).not.toHaveProperty("secret")
  })

  it("解包 Kotlin 列表 envelope 并调用定稿路由", async () => {
    const responses: Record<string, unknown> = {
      "/api/admin/ai/providers": { providers: [{ id: "p", providerType: "openai-compatible", displayName: "P", enabled: true, baseUrl: "https://example.invalid", defaultModel: "m", models: [{ id: "m", inputCentsPerMillion: 1, outputCentsPerMillion: 2, cachedInputCentsPerMillion: 1 }], restartRequired: false, updatedAt: "2026-01-01T00:00:00Z" }] },
      "/api/admin/commercial/orders": { orders: [{ id: "o", merchantOrderNo: "m", accountId: "a", productId: "AI_PERMANENT_99", provider: "ALIPAY", amountCents: 9900, giftCents: 0, status: "CREATED", createdAt: "2026-01-01T00:00:00Z" }] },
      "/api/admin/commercial/wallets": { wallets: [{ accountId: "a", giftCents: 1, cashCents: 2, availableCents: 3 }] },
      "/api/admin/commercial/ai/jobs": { jobs: [{ id: "j", accountId: "a", serverInstanceId: "s", status: "SUCCEEDED", operation: "PLAN", providerId: "p", model: "m", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z" }] },
      "/api/admin/commercial/releases": { releases: [{ id: "r", accountId: "a", serverInstanceId: "s", draftId: "d", draftVersionId: "v", draftVersionNumber: 1, expectedManifestRevision: "base", targetManifestRevision: "target", signingKeyId: "key", createdAt: "2026-01-01T00:00:00Z" }] },
    }
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = String(input)
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin-key")
      return new Response(JSON.stringify(responses[path]), { status: 200, headers: { "Content-Type": "application/json" } })
    })
    globalThis.fetch = fetchMock

    await expect(adminCommercialApi.providers("admin-key")).resolves.toHaveLength(1)
    await expect(adminCommercialApi.orders("admin-key")).resolves.toMatchObject([{ productCode: "AI_PERMANENT_99" }])
    await expect(adminCommercialApi.wallets("admin-key")).resolves.toHaveLength(1)
    await expect(adminCommercialApi.aiJobs("admin-key")).resolves.toHaveLength(1)
    await expect(adminCommercialApi.releases("admin-key")).resolves.toHaveLength(1)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/admin/commercial/ai/jobs")
  })
})
