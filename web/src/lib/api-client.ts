export interface ApiErrorEnvelope {
  code?: string
  message?: string
  error?: string | { code?: string; message?: string; details?: unknown }
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, envelope: ApiErrorEnvelope = {}) {
    const nested = typeof envelope.error === "object" ? envelope.error : undefined
    const message = nested?.message ?? envelope.message ?? (typeof envelope.error === "string" ? envelope.error : undefined) ?? `请求失败 (${status})`
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = nested?.code ?? envelope.code ?? `HTTP_${status}`
    this.details = nested?.details ?? envelope.details
  }
}

export interface ApiRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: TBody
  headers?: HeadersInit
  signal?: AbortSignal
}

interface SuccessEnvelope<T> {
  success?: boolean
  data: T
}

export function readCookie(name: string, cookieSource = typeof document === "undefined" ? "" : document.cookie): string | null {
  const prefix = `${encodeURIComponent(name)}=`
  for (const part of cookieSource.split(";")) {
    const cookie = part.trim()
    if (!cookie.startsWith(prefix)) continue
    try {
      return decodeURIComponent(cookie.slice(prefix.length))
    } catch {
      return cookie.slice(prefix.length)
    }
  }
  return null
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  return typeof value === "object" && value !== null && "data" in value
}

export function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = readCookie("orryx_csrf")
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)
  }
  return fetch(path, { ...init, method, credentials: "same-origin", headers })
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

export async function apiRequest<TResponse, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TResponse> {
  const method = options.method ?? "GET"
  const headers = new Headers(options.headers)
  const hasBody = options.body !== undefined

  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")

  const response = await apiFetch(path, {
    method,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
  const payload = await parsePayload(response)

  if (!response.ok) {
    const envelope = typeof payload === "object" && payload !== null ? payload as ApiErrorEnvelope : {}
    throw new ApiError(response.status, envelope)
  }

  return (isSuccessEnvelope<TResponse>(payload) ? payload.data : payload) as TResponse
}

export function apiErrorMessage(error: unknown, fallback = "请求失败，请稍后重试。") {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}
