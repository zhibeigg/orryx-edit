import { apiRequest } from "@/lib/api-client"
import type { AiJobStatus, AiOperation } from "@/lib/ai-jobs"

export interface AdminAiProviderModel {
  id: string
  inputCentsPerMillion: number
  outputCentsPerMillion: number
  cachedInputCentsPerMillion: number
}

export interface AdminAiProvider {
  id: string
  providerType: string
  displayName: string
  enabled: boolean
  baseUrl: string
  models: AdminAiProviderModel[]
  defaultModel: string
  restartRequired: boolean
  updatedAt: string
}

export interface AdminAiProviderUpdate {
  displayName: string
  enabled: boolean
  providerType: string
  baseUrl: string
  models: AdminAiProviderModel[]
  defaultModel: string
}

export interface AdminOrderRow {
  id: string
  merchantOrderNo: string
  accountId: string
  productId: string
  productCode: string
  amountCents: number
  giftCents: number
  status: string
  provider: string
  providerTransactionId?: string | null
  createdAt: string
  paidAt?: string | null
}

export interface AdminWalletRow {
  accountId: string
  cashCents: number
  giftCents: number
  availableCents: number
}

export interface AdminAiJobRow {
  id: string
  accountId: string
  serverInstanceId: string
  draftId?: string | null
  status: AiJobStatus
  operation: AiOperation
  providerId: string
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  costAmount?: number | null
  errorCode?: string | null
  createdAt: string
  updatedAt: string
  finishedAt?: string | null
}

export interface AdminReleaseRow {
  id: string
  accountId: string
  serverInstanceId: string
  draftId: string
  draftVersionId: string
  draftVersionNumber: number
  expectedManifestRevision: string
  targetManifestRevision: string
  signingKeyId: string
  transactionId?: string | null
  transactionStatus?: string | null
  createdAt: string
}

interface ProvidersEnvelope { providers: AdminAiProvider[] }
interface OrdersEnvelope { orders: Omit<AdminOrderRow, "productCode">[] }
interface WalletsEnvelope { wallets: AdminWalletRow[] }
interface AiJobsEnvelope { jobs: AdminAiJobRow[] }
interface ReleasesEnvelope { releases: AdminReleaseRow[] }

export function providerUpdateDto(input: AdminAiProvider): AdminAiProviderUpdate {
  return {
    displayName: input.displayName,
    enabled: input.enabled,
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    models: input.models.map((model) => ({
      id: model.id,
      inputCentsPerMillion: model.inputCentsPerMillion,
      outputCentsPerMillion: model.outputCentsPerMillion,
      cachedInputCentsPerMillion: model.cachedInputCentsPerMillion,
    })),
    defaultModel: input.defaultModel,
  }
}

function adminHeaders(adminKey: string): HeadersInit {
  return { Authorization: `Bearer ${adminKey}` }
}

export const adminCommercialApi = {
  async providers(adminKey: string, signal?: AbortSignal) {
    const response = await apiRequest<ProvidersEnvelope>("/api/admin/ai/providers", { headers: adminHeaders(adminKey), signal })
    return response.providers
  },
  provider(adminKey: string, id: string, signal?: AbortSignal) {
    return apiRequest<AdminAiProvider>(`/api/admin/ai/providers/${encodeURIComponent(id)}`, { headers: adminHeaders(adminKey), signal })
  },
  updateProvider(adminKey: string, id: string, input: AdminAiProviderUpdate, signal?: AbortSignal) {
    return apiRequest<AdminAiProvider, AdminAiProviderUpdate>(`/api/admin/ai/providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: input,
      headers: adminHeaders(adminKey),
      signal,
    })
  },
  async orders(adminKey: string, signal?: AbortSignal) {
    const response = await apiRequest<OrdersEnvelope>("/api/admin/commercial/orders", { headers: adminHeaders(adminKey), signal })
    return response.orders.map((order) => ({ ...order, productCode: order.productId }))
  },
  async wallets(adminKey: string, signal?: AbortSignal) {
    const response = await apiRequest<WalletsEnvelope>("/api/admin/commercial/wallets", { headers: adminHeaders(adminKey), signal })
    return response.wallets
  },
  async aiJobs(adminKey: string, signal?: AbortSignal) {
    const response = await apiRequest<AiJobsEnvelope>("/api/admin/commercial/ai/jobs", { headers: adminHeaders(adminKey), signal })
    return response.jobs
  },
  async releases(adminKey: string, signal?: AbortSignal) {
    const response = await apiRequest<ReleasesEnvelope>("/api/admin/commercial/releases", { headers: adminHeaders(adminKey), signal })
    return response.releases
  },
}
