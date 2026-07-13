import { useCallback, useEffect, useRef, useState } from "react"
import type { KetherDocsApiError, KetherDocsStatus } from "./kether-docs-types"

async function ketherDocsApi(adminKey: string, path: string, init?: RequestInit): Promise<KetherDocsStatus> {
  const response = await fetch(`/api/admin/kether-docs${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: "KETHER_DOCS_REQUEST_FAILED" })) as KetherDocsApiError
    throw new Error(error.code)
  }
  return response.json() as Promise<KetherDocsStatus>
}

export function useKetherDocsSync(adminKey: string) {
  const [status, setStatus] = useState<KetherDocsStatus | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await ketherDocsApi(adminKey, "/status")
      if (!mounted.current) return
      setStatus(next)
      setErrorCode(null)
    } catch (error) {
      if (mounted.current) setErrorCode(error instanceof Error ? error.message : "KETHER_DOCS_REQUEST_FAILED")
    }
  }, [adminKey])

  const synchronize = useCallback(async () => {
    setLoading(true)
    setErrorCode(null)
    try {
      const next = await ketherDocsApi(adminKey, "/sync", { method: "POST" })
      if (mounted.current) setStatus(next)
    } catch (error) {
      if (mounted.current) setErrorCode(error instanceof Error ? error.message : "KETHER_DOCS_REQUEST_FAILED")
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [adminKey])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [refresh])

  return { status, errorCode, loading, refresh, synchronize }
}
