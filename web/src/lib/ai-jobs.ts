import { apiRequest } from "@/lib/api-client"

export type AiJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
export type AiOperation = "GENERATE" | "VALIDATE" | "PLAN"

export interface CreateAiJobInput {
  serverInstanceId: string
  draftId?: string
  baseVersionId?: string
  operation: AiOperation
  prompt: string
  providerId: string
  model: string
  idempotencyKey: string
}

export interface AiJob {
  id: string
  serverInstanceId: string
  draftId?: string | null
  baseVersionId?: string | null
  status: AiJobStatus
  operation: AiOperation
  prompt?: string
  providerId?: string
  model?: string
  runnerResult?: unknown
  usage?: unknown
  costAmount?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export interface PollAiJobOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onUpdate?: (job: AiJob) => void
}

const TERMINAL_STATUSES = new Set<AiJobStatus>(["SUCCEEDED", "FAILED", "CANCELED"])

export const aiJobApi = {
  create(input: CreateAiJobInput, signal?: AbortSignal) {
    return apiRequest<AiJob, CreateAiJobInput>("/api/v2/ai/jobs", { method: "POST", body: input, signal })
  },
  get(id: string, signal?: AbortSignal) {
    return apiRequest<AiJob>(`/api/v2/ai/jobs/${encodeURIComponent(id)}`, { signal })
  },
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("轮询已取消", "AbortError"))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer)
      reject(signal.reason ?? new DOMException("轮询已取消", "AbortError"))
    }, { once: true })
  })
}

export async function pollAiJob(id: string, options: PollAiJobOptions = {}): Promise<AiJob> {
  const intervalMs = options.intervalMs ?? 1_500
  const timeoutMs = options.timeoutMs ?? 120_000
  const startedAt = Date.now()

  while (true) {
    const job = await aiJobApi.get(id, options.signal)
    options.onUpdate?.(job)
    if (TERMINAL_STATUSES.has(job.status)) return job
    if (Date.now() - startedAt >= timeoutMs) throw new Error("AI 任务轮询超时。")
    await wait(intervalMs, options.signal)
  }
}

export async function createAndPollAiJob(input: CreateAiJobInput, options: PollAiJobOptions = {}) {
  const job = await aiJobApi.create(input, options.signal)
  options.onUpdate?.(job)
  return TERMINAL_STATUSES.has(job.status) ? job : pollAiJob(job.id, options)
}
