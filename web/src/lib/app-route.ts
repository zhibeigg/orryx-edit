export type AppRoute =
  | { kind: "editor" }
  | { kind: "portal" }
  | { kind: "admin" }
  | { kind: "workbench"; workspaceId: string; serverInstanceId: string }

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.trim() ? decoded : null
  } catch {
    return null
  }
}

export function parseAppRoute(pathname: string): AppRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (normalized === "/portal") return { kind: "portal" }
  if (normalized === "/admin") return { kind: "admin" }

  const match = normalized.match(/^\/workspaces\/([^/]+)\/servers\/([^/]+)$/)
  if (match) {
    const workspaceId = decodeSegment(match[1])
    const serverInstanceId = decodeSegment(match[2])
    if (workspaceId && serverInstanceId) return { kind: "workbench", workspaceId, serverInstanceId }
  }

  return { kind: "editor" }
}

export function workbenchPath(workspaceId: string, serverInstanceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverInstanceId)}`
}
