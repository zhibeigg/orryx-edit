import { apiRequest } from "@/lib/api-client"
import type { AiJob, CreateAiJobInput } from "@/lib/ai-jobs"
import type { CloudDraft, CloudDraftListResponse, CloudDraftVersion, CreateCloudDraftInput } from "@/lib/cloud-drafts"

export interface AiProviderOption {
  id: string
  providerId?: string
  displayName?: string
  enabled?: boolean
  models: string[]
  defaultModel?: string
  disabledReason?: string | null
}

export interface AiJobEvent {
  id?: string
  jobId?: string
  sequence?: number
  seq?: number
  type: string
  eventType?: string
  message?: string
  createdAt: string
  payload?: unknown
}

interface AiJobEventWire extends Omit<AiJobEvent, "type"> {
  type?: string
}

export interface ServerSnapshotFile {
  path: string
  revision: string
  size: number
  content?: string | null
}

export interface ServerSnapshot {
  id: string
  serverInstanceId: string
  manifestRevision: string
  source: string
  status?: string
  createdAt: string
  files?: ServerSnapshotFile[]
}

export interface ServerHistoryEntry {
  id: string
  kind: "SNAPSHOT" | "RELEASE"
  source: string
  status: string
  manifestRevision: string
  createdAt: string
  snapshotId?: string
  releaseId?: string
  transactionId?: string
  draftId?: string
  draftVersionId?: string
}

interface ServerHistoryWire {
  id: string
  kind?: "SNAPSHOT" | "RELEASE"
  type?: "SNAPSHOT" | "RELEASE" | "RELEASE_TRANSACTION" | string
  source?: string | null
  status?: string | null
  manifestRevision?: string | null
  createdAt: string
  snapshotId?: string
  releaseId?: string
  transactionId?: string
  draftId?: string
  draftVersionId?: string
}

export interface RestoreSnapshotInput {
  title?: string
}

export interface CreateReleaseInput {
  serverInstanceId: string
  draftId: string
  draftVersionId: string
  expectedCurrentVersion: number
  expectedBaseManifestRevision: string
}

export interface SignedRelease {
  id: string
  serverInstanceId: string
  draftId: string
  draftVersionId: string
  draftVersionNumber: number
  expectedManifestRevision: string
  targetManifestRevision: string
  signingKeyId?: string
  canonicalPayloadSha256?: string
  createdAt: string
}

export type ReleaseTransactionStatus =
  | "QUEUED"
  | "PREPARE_DISPATCHED"
  | "PREPARED"
  | "COMMIT_DISPATCHED"
  | "READINESS_PENDING"
  | "ROLLBACK_DISPATCHED"
  | "SUCCEEDED"
  | "ROLLED_BACK"
  | "FAILED"
  | "RECOVERY_REQUIRED"

export interface ReleaseTransaction {
  id: string
  releaseId: string
  serverInstanceId: string
  status: ReleaseTransactionStatus
  stateVersion: number
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  finishedAt?: string | null
}

export interface CreateReleaseResponse {
  release: SignedRelease
  transaction: ReleaseTransaction
  replayed?: boolean
}

export interface WalletLedgerEntry {
  id: string
  type: string
  operationType?: string
  amountCents: number
  cashDeltaCents?: number
  giftDeltaCents?: number
  cashBalanceCents?: number
  giftBalanceCents?: number
  balanceCents?: number
  description?: string
  createdAt: string
}

interface WalletLedgerWire extends Omit<WalletLedgerEntry, "type" | "amountCents"> {
  type?: string
  amountCents?: number
}

export interface BillingOrderHistory {
  id: string
  orderId?: string
  merchantOrderNo?: string
  productCode: string
  productId?: string
  amountCents: number
  status: string
  provider?: string
  createdAt: string
  paidAt?: string | null
}

export type ListEnvelope<T, K extends string> = T[] | Record<K, T[]>

export function resolveList<T, K extends string>(response: ListEnvelope<T, K>, key: K): T[] {
  return Array.isArray(response) ? response : response[key]
}

export function resolveProviders(response: ListEnvelope<AiProviderOption, "providers">): AiProviderOption[] {
  return resolveList(response, "providers").map((provider) => ({ ...provider, enabled: provider.enabled !== false }))
}

export function resolveJobEvents(response: AiJobEventWire[] | { events: AiJobEventWire[] }): AiJobEvent[] {
  const events = Array.isArray(response) ? response : response.events
  return events.map((event) => ({ ...event, type: event.type ?? event.eventType ?? "EVENT", sequence: event.sequence ?? event.seq }))
}

export function resolveServerHistory(response: ServerHistoryWire[] | { history?: ServerHistoryWire[]; items?: ServerHistoryWire[] }): ServerHistoryEntry[] {
  const items = Array.isArray(response) ? response : response.history ?? response.items ?? []
  return items.map((item) => ({
    id: item.id,
    kind: item.kind ?? (item.type === "SNAPSHOT" ? "SNAPSHOT" : "RELEASE"),
    source: item.source ?? item.type ?? "UNKNOWN",
    status: item.status ?? "AVAILABLE",
    manifestRevision: item.manifestRevision ?? "—",
    createdAt: item.createdAt,
    snapshotId: item.snapshotId ?? (item.type === "SNAPSHOT" ? item.id : undefined),
    releaseId: item.releaseId,
    transactionId: item.transactionId,
    draftId: item.draftId,
    draftVersionId: item.draftVersionId,
  }))
}

export function resolveWalletLedger(response: WalletLedgerWire[] | { entries: WalletLedgerWire[] }): WalletLedgerEntry[] {
  const entries = Array.isArray(response) ? response : response.entries
  return entries.map((entry) => ({ ...entry, type: entry.type ?? entry.operationType ?? "UNKNOWN", amountCents: entry.amountCents ?? (entry.cashDeltaCents ?? 0) + (entry.giftDeltaCents ?? 0) }))
}

export function resolveBillingOrders(response: Array<Partial<BillingOrderHistory> & Pick<BillingOrderHistory, "id" | "amountCents" | "status" | "createdAt">> | { orders: Array<Partial<BillingOrderHistory> & Pick<BillingOrderHistory, "id" | "amountCents" | "status" | "createdAt">> }): BillingOrderHistory[] {
  const orders = Array.isArray(response) ? response : response.orders
  return orders.map((order) => ({ ...order, productCode: order.productCode ?? order.productId ?? "UNKNOWN" })) as BillingOrderHistory[]
}

export const workbenchApi = {
  providers(signal?: AbortSignal) {
    return apiRequest<ListEnvelope<AiProviderOption, "providers">>("/api/v2/ai/providers", { signal })
  },
  jobs(serverInstanceId: string, draftId?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ serverInstanceId })
    if (draftId) query.set("draftId", draftId)
    return apiRequest<ListEnvelope<AiJob, "jobs">>(`/api/v2/ai/jobs?${query.toString()}`, { signal })
  },
  createJob(input: CreateAiJobInput, signal?: AbortSignal) {
    return apiRequest<AiJob, CreateAiJobInput>("/api/v2/ai/jobs", { method: "POST", body: input, signal })
  },
  job(id: string, signal?: AbortSignal) {
    return apiRequest<AiJob>(`/api/v2/ai/jobs/${encodeURIComponent(id)}`, { signal })
  },
  jobEvents(id: string, signal?: AbortSignal) {
    return apiRequest<AiJobEventWire[] | { events: AiJobEventWire[] }>(`/api/v2/ai/jobs/${encodeURIComponent(id)}/events`, { signal })
  },
  cancelJob(id: string, signal?: AbortSignal) {
    return apiRequest<AiJob>(`/api/v2/ai/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", signal })
  },
  drafts(serverInstanceId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ serverInstanceId })
    return apiRequest<CloudDraftListResponse>(`/api/v2/drafts?${query.toString()}`, { signal })
  },
  createDraft(input: CreateCloudDraftInput, signal?: AbortSignal) {
    return apiRequest<CloudDraft, CreateCloudDraftInput>("/api/v2/drafts", { method: "POST", body: input, signal })
  },
  draft(id: string, signal?: AbortSignal) {
    return apiRequest<CloudDraft>(`/api/v2/drafts/${encodeURIComponent(id)}`, { signal })
  },
  draftVersions(id: string, signal?: AbortSignal) {
    return apiRequest<ListEnvelope<CloudDraftVersion, "versions">>(`/api/v2/drafts/${encodeURIComponent(id)}/versions`, { signal })
  },
  draftVersion(id: string, versionId: string, signal?: AbortSignal) {
    return apiRequest<CloudDraftVersion>(`/api/v2/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, { signal })
  },
  snapshots(serverInstanceId: string, signal?: AbortSignal) {
    return apiRequest<ListEnvelope<ServerSnapshot, "snapshots">>(`/api/v2/server-instances/${encodeURIComponent(serverInstanceId)}/snapshots`, { signal })
  },
  history(serverInstanceId: string, signal?: AbortSignal) {
    return apiRequest<ServerHistoryWire[] | { history?: ServerHistoryWire[]; items?: ServerHistoryWire[] }>(`/api/v2/server-instances/${encodeURIComponent(serverInstanceId)}/history`, { signal })
  },
  restoreFromHistory(serverInstanceId: string, snapshotId: string, input: RestoreSnapshotInput = {}, signal?: AbortSignal) {
    return apiRequest<CloudDraft, RestoreSnapshotInput>(`/api/v2/server-instances/${encodeURIComponent(serverInstanceId)}/history/${encodeURIComponent(snapshotId)}/restore`, { method: "POST", body: input, signal })
  },
  releases(serverInstanceId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ serverInstanceId })
    return apiRequest<ListEnvelope<SignedRelease, "releases">>(`/api/v2/releases?${query.toString()}`, { signal })
  },
  createRelease(input: CreateReleaseInput, idempotencyKey: string, signal?: AbortSignal) {
    return apiRequest<CreateReleaseResponse, CreateReleaseInput>("/api/v2/releases", {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": idempotencyKey },
      signal,
    })
  },
  releaseTransaction(id: string, signal?: AbortSignal) {
    return apiRequest<ReleaseTransaction>(`/api/v2/release-transactions/${encodeURIComponent(id)}`, { signal })
  },
  rollbackRelease(id: string, reason = "USER_REQUESTED", signal?: AbortSignal) {
    return apiRequest<ReleaseTransaction, { reason: string }>(`/api/v2/release-transactions/${encodeURIComponent(id)}/rollback`, { method: "POST", body: { reason }, signal })
  },
  walletLedger(signal?: AbortSignal) {
    return apiRequest<WalletLedgerWire[] | { entries: WalletLedgerWire[] }>("/api/v2/billing/ledger", { signal })
  },
  orderHistory(signal?: AbortSignal) {
    return apiRequest<Array<Partial<BillingOrderHistory> & Pick<BillingOrderHistory, "id" | "amountCents" | "status" | "createdAt">> | { orders: Array<Partial<BillingOrderHistory> & Pick<BillingOrderHistory, "id" | "amountCents" | "status" | "createdAt">> }>("/api/v2/billing/orders", { signal })
  },
}

export function createIdempotencyKey(prefix: "ai" | "release"): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `web:${prefix}:${random}`
}
