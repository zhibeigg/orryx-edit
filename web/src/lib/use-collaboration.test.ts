import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  acknowledgeSavedRevision,
  resetAcknowledgedRevisionChainsForTests,
  resolveAcknowledgedSaveRevision,
} from "@/lib/acknowledged-revision-chain"
import { fileSaveQueueKey } from "@/lib/file-save-snapshot"
import { useConnectionStore } from "@/store/connection-store"
import { useEditorStore, type OpenFile } from "@/store/editor-store"

const mocks = vi.hoisted(() => ({
  resynchronizeOpenFiles: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("@/lib/server-file", () => ({
  resynchronizeOpenFiles: mocks.resynchronizeOpenFiles,
}))
vi.mock("@/lib/ws-client", () => ({
  wsClient: {
    on: vi.fn(() => () => undefined),
    updatePresence: vi.fn(),
  },
}))

import { applyRelayServerInfo } from "@/lib/use-collaboration"

const workspaceId = "workspace-a"
const file: OpenFile = {
  workspaceId,
  path: "skills/fire.yml",
  name: "fire.yml",
  content: "server-old",
  configType: "skill",
  revision: 7,
  draft: "dirty-local-draft",
  dirty: true,
  draftVersion: 3,
}

function serverInfo(online: boolean, negotiatedProtocol: "v1" | "v2", sessionEpoch: number) {
  return {
    online,
    workspaceId,
    serverId: "stable-server",
    serverName: "Stable",
    negotiatedProtocol,
    sessionEpoch,
    relayCapabilities: negotiatedProtocol === "v2"
      ? ["protocol.allowlist", "session.epoch", "revision.sha256", "file.write.v2"]
      : ["protocol.allowlist", "session.epoch"],
  }
}

describe("Relay server.info collaboration 生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAcknowledgedRevisionChainsForTests()
    useConnectionStore.setState({
      connected: true,
      authenticated: true,
      reconnecting: false,
      workspaceId,
      browserId: "browser-a",
      playerName: "Alice",
      serverName: "Stable",
      serverId: "stable-server",
      serverOnline: true,
      negotiatedProtocol: "v1",
      sessionEpoch: 1,
      relayCapabilities: ["protocol.allowlist", "session.epoch"],
      onlineCount: 1,
      collaborators: [],
      error: null,
    })
    useEditorStore.setState({
      workspaceId,
      openFiles: [file],
      activeFilePath: file.path,
      recentlyClosed: [],
      fileContents: new Map([[file.path, file.content]]),
      saveConflict: null,
      lifecycleError: null,
    })
  })

  it("offline 保留认证和 dirty 草稿，同时切断 acknowledged revision chain 并标记未验证", async () => {
    const key = fileSaveQueueKey(workspaceId, file.path)
    acknowledgeSavedRevision(key, 7, 7, 8)
    expect(resolveAcknowledgedSaveRevision(key, 7)).toBe(8)

    await expect(applyRelayServerInfo(serverInfo(false, "v1", 1))).resolves.toBe(true)

    expect(mocks.resynchronizeOpenFiles).not.toHaveBeenCalled()
    expect(useConnectionStore.getState()).toMatchObject({
      connected: true,
      authenticated: true,
      workspaceId,
      serverOnline: false,
    })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      revision: 7,
      externalRevision: 7,
      draft: "dirty-local-draft",
      dirty: true,
    })
    expect(resolveAcknowledgedSaveRevision(key, 7)).toBe(7)
  })

  it("每次 online 权威切换都按新 sessionEpoch 触发 V1 与 V2 revision 域刷新", async () => {
    await applyRelayServerInfo(serverInfo(true, "v2", 2))
    await applyRelayServerInfo(serverInfo(true, "v1", 3))

    expect(mocks.resynchronizeOpenFiles).toHaveBeenCalledTimes(2)
    expect(mocks.resynchronizeOpenFiles).toHaveBeenNthCalledWith(1, workspaceId)
    expect(mocks.resynchronizeOpenFiles).toHaveBeenNthCalledWith(2, workspaceId)
    expect(useConnectionStore.getState()).toMatchObject({
      serverOnline: true,
      serverId: "stable-server",
      negotiatedProtocol: "v1",
      sessionEpoch: 3,
      relayCapabilities: ["protocol.allowlist", "session.epoch"],
    })
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      draft: "dirty-local-draft",
      dirty: true,
      externalRevision: 7,
    })
  })

  it("忽略其他 workspace 或字段不完整的 server info", async () => {
    await expect(applyRelayServerInfo({ ...serverInfo(false, "v1", 1), workspaceId: "workspace-b" })).resolves.toBe(false)
    await expect(applyRelayServerInfo({ online: false, workspaceId })).resolves.toBe(false)

    expect(useConnectionStore.getState().serverOnline).toBe(true)
    expect(mocks.resynchronizeOpenFiles).not.toHaveBeenCalled()
  })
})
