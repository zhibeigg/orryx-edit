import { useCallback, useEffect, useRef, useState } from "react"
import type { UpdateApiError, UpdateJob, UpdateJobAction, UpdateOverview } from "./update-types"

const ACTIVE = new Set(["QUEUED", "CHECKING", "DOWNLOADING", "VERIFYING"])

async function updateApi<T>(adminKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/update${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: "UPDATE_REQUEST_FAILED" })) as UpdateApiError
    throw new Error(error.code)
  }
  return response.json() as Promise<T>
}

export function useUpdateJob(adminKey: string) {
  const [overview, setOverview] = useState<UpdateOverview | null>(null)
  const [job, setJob] = useState<UpdateJob | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await updateApi<UpdateOverview>(adminKey, "/status")
      if (!mounted.current) return
      setOverview(next)
      setJob(next.job ?? null)
      setErrorCode(null)
    } catch (error) {
      if (mounted.current) setErrorCode(error instanceof Error ? error.message : "UPDATE_REQUEST_FAILED")
    }
  }, [adminKey])

  const start = useCallback(async (action: UpdateJobAction, force = false) => {
    setLoading(true)
    setErrorCode(null)
    try {
      const next = await updateApi<UpdateJob>(adminKey, "/jobs", {
        method: "POST",
        body: JSON.stringify({ action, force }),
      })
      if (mounted.current) setJob(next)
      return next
    } catch (error) {
      if (mounted.current) setErrorCode(error instanceof Error ? error.message : "UPDATE_REQUEST_FAILED")
      return null
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [adminKey])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) return
    const timer = window.setInterval(async () => {
      try {
        const next = await updateApi<UpdateJob>(adminKey, `/jobs/${encodeURIComponent(job.id)}`)
        if (!mounted.current) return
        setJob(next)
        if (!ACTIVE.has(next.status)) void refresh()
      } catch (error) {
        if (mounted.current) setErrorCode(error instanceof Error ? error.message : "UPDATE_REQUEST_FAILED")
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [adminKey, job, refresh])

  return { overview, job, errorCode, loading, refresh, start }
}
