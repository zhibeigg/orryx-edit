export interface ScrubbedConnectionCredential {
  token: string | null
  rejectedQueryToken: boolean
}

export function extractAndScrubUrlToken(): ScrubbedConnectionCredential {
  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
  const rejectedQueryToken = url.searchParams.has("token")
  const fragmentToken = hashParams.get("token")?.trim() || null

  if (rejectedQueryToken || hashParams.has("token")) {
    // 在任何认证网络请求前清除凭据；Fragment 不保留到截图、复制链接或历史记录中。
    url.searchParams.delete("token")
    url.hash = ""
    window.history.replaceState({}, "", `${url.pathname}${url.search}`)
  }

  return {
    token: rejectedQueryToken ? null : fragmentToken,
    rejectedQueryToken,
  }
}
