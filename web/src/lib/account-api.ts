import { apiRequest } from "@/lib/api-client"

export interface AccountView {
  id: string
  email: string
  displayName: string
  status?: "ACTIVE" | "SUSPENDED" | "DISABLED" | string
  createdAt?: string
  updatedAt?: string
}

export interface AuthSessionView {
  account?: AccountView
  user?: AccountView
  id?: string
  email?: string
  displayName?: string
  status?: string
}

export interface RegisterInput {
  email: string
  password: string
  displayName: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface LicenseClaimResult {
  outcome: "CLAIMED" | "ALREADY_OWNED" | "OWNED_BY_ANOTHER_ACCOUNT" | "LICENSE_NOT_FOUND_OR_INACTIVE" | string
  claim?: {
    licenseKey: string
    workspaceId: string
    status: string
    claimedAt?: string
  } | null
}

export interface ServerInstanceSummary {
  id: string
  displayName?: string
  stableServerId?: string
  licenseKey?: string
  lastSeenAt?: string
  online?: boolean
}

export interface WorkspaceSummary {
  id?: string
  workspaceId?: string
  name?: string
  displayName?: string
  role?: string
  serverInstances?: ServerInstanceSummary[]
  servers?: ServerInstanceSummary[]
}

export type WorkspacesResponse = WorkspaceSummary[] | { workspaces: WorkspaceSummary[] }

export interface EntitlementSummary {
  type: string
  grantedAt?: string
}

export interface BillingSummary {
  permanentAi?: boolean
  aiPermanent?: boolean
  entitlements?: EntitlementSummary[]
  wallet?: {
    cashCents: number
    giftCents: number
    availableCents?: number
  }
  balance?: {
    cashCents: number
    giftCents: number
    availableCents?: number
  }
  cashCents?: number
  giftCents?: number
}

export interface BillingOrder {
  payUrl: string
  orderId?: string
  status?: string
}

export const accountApi = {
  register(input: RegisterInput) {
    return apiRequest<AuthSessionView, RegisterInput>("/api/v2/auth/register", { method: "POST", body: input })
  },
  login(input: LoginInput) {
    return apiRequest<AuthSessionView, LoginInput>("/api/v2/auth/login", { method: "POST", body: input })
  },
  logout() {
    return apiRequest<void>("/api/v2/auth/logout", { method: "POST" })
  },
  me() {
    return apiRequest<AuthSessionView>("/api/v2/auth/me")
  },
  claimLicense(license: string) {
    return apiRequest<LicenseClaimResult, { license: string }>("/api/v2/licenses/claim", {
      method: "POST",
      body: { license },
    })
  },
  workspaces() {
    return apiRequest<WorkspacesResponse>("/api/v2/workspaces")
  },
  billingSummary() {
    return apiRequest<BillingSummary>("/api/v2/billing/summary")
  },
  createPermanentAiOrder() {
    return apiRequest<BillingOrder, { productCode: "AI_PERMANENT_99" }>("/api/v2/billing/orders", {
      method: "POST",
      body: { productCode: "AI_PERMANENT_99" },
    })
  },
}

export function resolveAccount(session: AuthSessionView): AccountView | null {
  if (session.account) return session.account
  if (session.user) return session.user
  if (session.id && session.email && session.displayName) {
    return { id: session.id, email: session.email, displayName: session.displayName, status: session.status }
  }
  return null
}

export function resolveWorkspaces(response: WorkspacesResponse): WorkspaceSummary[] {
  return Array.isArray(response) ? response : response.workspaces
}
