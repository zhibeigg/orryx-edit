import { describe, expect, it } from "vitest"
import { promptCacheKey, workbenchCacheKey } from "@/lib/workbench-cache"

describe("工作台缓存键", () => {
  it("包含账户、workspace、server、draft、version 与 path", () => {
    expect(workbenchCacheKey({
      accountId: "account:1",
      workspaceId: "workspace/1",
      serverInstanceId: "server 1",
      draftId: "draft-1",
      versionId: "version-2",
      path: "skills/fire.yml",
    })).toBe("workbench:v1:account%3A1:workspace%2F1:server%201:draft-1:version-2:skills%2Ffire.yml")
  })

  it("prompt 使用同一隔离维度", () => {
    expect(promptCacheKey("a", "w", "s")).toContain("workbench:v1:a:w:s:prompt:latest:prompt.txt")
  })
})
