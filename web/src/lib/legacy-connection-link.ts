export function migrateLegacyConnectionLink(): boolean {
  if (window.location.pathname !== "/") return false
  const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash)
  if (!hashParams.has("token")) return false

  // Fragment 不会发送给服务端；replace 也不会把旧根路径留在浏览器历史中。
  window.location.replace(`/connect${window.location.hash}`)
  return true
}
