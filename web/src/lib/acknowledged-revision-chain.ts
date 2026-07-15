import type { RevisionToken } from "@/types/protocol"

interface AcknowledgedRevisionChain {
  confirmedRevision: RevisionToken
  inheritableBases: Set<RevisionToken>
}

const chains = new Map<string, AcknowledgedRevisionChain>()

export function resolveAcknowledgedSaveRevision(
  key: string,
  requestedBaseRevision: RevisionToken,
  force = false,
): RevisionToken {
  if (force) return requestedBaseRevision
  const chain = chains.get(key)
  return chain?.inheritableBases.has(requestedBaseRevision)
    ? chain.confirmedRevision
    : requestedBaseRevision
}

/** 仅记录本客户端成功写入所确认的 revision，并保留并发排队调用捕获的旧 base。 */
export function acknowledgeSavedRevision(
  key: string,
  requestedBaseRevision: RevisionToken,
  effectiveBaseRevision: RevisionToken,
  confirmedRevision: RevisionToken,
) {
  const previous = chains.get(key)
  const inheritableBases = new Set(previous?.inheritableBases)
  inheritableBases.add(requestedBaseRevision)
  inheritableBases.add(effectiveBaseRevision)
  inheritableBases.add(confirmedRevision)
  chains.set(key, { confirmedRevision, inheritableBases })
}

/** 外部变更、服务器重载或新打开快照会切断本地确认链，后续保存必须重新做 revision 检查。 */
export function invalidateAcknowledgedRevisionChain(key: string) {
  chains.delete(key)
}

export function invalidateAcknowledgedRevisionChainsMatching(
  workspaceId: string | null,
  matches: (path: string) => boolean,
) {
  if (!workspaceId) return
  const prefix = `${workspaceId}:`
  for (const key of chains.keys()) {
    if (key.startsWith(prefix) && matches(key.slice(prefix.length))) chains.delete(key)
  }
}

export function clearAcknowledgedRevisionChainsForWorkspace(workspaceId: string | null) {
  invalidateAcknowledgedRevisionChainsMatching(workspaceId, () => true)
}

/** 仅供测试清理模块级状态。 */
export function resetAcknowledgedRevisionChainsForTests() {
  chains.clear()
}
