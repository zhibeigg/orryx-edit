import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  setWorkspace: vi.fn<() => Promise<boolean>>(),
  resetFiles: vi.fn(),
}))

vi.mock("@/store/editor-store", () => ({
  useEditorStore: {
    getState: () => ({ setWorkspace: mocks.setWorkspace }),
  },
}))
vi.mock("@/store/file-store", () => ({
  useFileStore: {
    getState: () => ({ reset: mocks.resetFiles }),
  },
}))

import { useConnectionStore } from "@/store/connection-store"

function authenticatedState() {
  useConnectionStore.setState({
    connected: false,
    authenticated: true,
    reconnecting: true,
    workspaceId: "workspace-a",
    browserId: "browser-a",
    playerName: "Steve",
    serverName: "Alpha",
    serverId: "alpha",
    serverOnline: true,
    negotiatedProtocol: "v2",
    sessionEpoch: 1,
    relayCapabilities: ["relay.v2"],
    onlineCount: 1,
    collaborators: [],
    error: "连接已断开",
  })
}

describe("connection-store 认证失败收口", () => {
  beforeEach(() => {
    mocks.setWorkspace.mockReset()
    mocks.resetFiles.mockReset()
    authenticatedState()
  })

  it("草稿持久化完成后再清理工作区并关闭伪认证", async () => {
    mocks.setWorkspace.mockResolvedValue(true)

    await expect(useConnectionStore.getState().setAuthenticated(false)).resolves.toBe(true)

    expect(mocks.setWorkspace).toHaveBeenCalledWith(null)
    expect(mocks.resetFiles).toHaveBeenCalledOnce()
    expect(useConnectionStore.getState()).toMatchObject({
      connected: false,
      authenticated: false,
      reconnecting: false,
      workspaceId: null,
      serverOnline: false,
    })
  })

  it("草稿持久化失败时保留工作区内容但仍关闭伪认证", async () => {
    mocks.setWorkspace.mockResolvedValue(false)

    await expect(useConnectionStore.getState().setAuthenticated(false)).resolves.toBe(false)

    expect(mocks.resetFiles).not.toHaveBeenCalled()
    expect(useConnectionStore.getState()).toMatchObject({
      connected: false,
      authenticated: false,
      reconnecting: false,
      workspaceId: "workspace-a",
      serverOnline: false,
    })
  })
})
