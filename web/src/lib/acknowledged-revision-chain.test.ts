import { beforeEach, describe, expect, it } from "vitest"
import {
  acknowledgeSavedRevision,
  invalidateAcknowledgedRevisionChain,
  invalidateAcknowledgedRevisionChainsMatching,
  resetAcknowledgedRevisionChainsForTests,
  resolveAcknowledgedSaveRevision,
} from "@/lib/acknowledged-revision-chain"

describe("本地已确认 revision 链", () => {
  const key = "workspace-a:skills/fire.yml"

  beforeEach(() => resetAcknowledgedRevisionChainsForTests())

  it("连续排队保存可继承本客户端前一次成功保存产生的新 revision", () => {
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-b")
    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-b")

    acknowledgeSavedRevision(key, "rev-a", "rev-b", "rev-c")
    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-c")
  })

  it("外部变更切断本地链，旧 base 不会被替换成外部 revision", () => {
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-b")
    invalidateAcknowledgedRevisionChain(key)

    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-a")
    expect(resolveAcknowledgedSaveRevision(key, "rev-external")).toBe("rev-external")
  })

  it("目录生命周期操作会切断全部子路径 revision 链", () => {
    const nestedKey = "workspace-a:skills/nested/ice.yml"
    const unrelatedKey = "workspace-a:jobs/mage.yml"
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-b")
    acknowledgeSavedRevision(nestedKey, 1, 1, 2)
    acknowledgeSavedRevision(unrelatedKey, "job-a", "job-a", "job-b")

    invalidateAcknowledgedRevisionChainsMatching(
      "workspace-a",
      (path) => path === "skills" || path.startsWith("skills/"),
    )

    expect(resolveAcknowledgedSaveRevision(key, "rev-a")).toBe("rev-a")
    expect(resolveAcknowledgedSaveRevision(nestedKey, 1)).toBe(1)
    expect(resolveAcknowledgedSaveRevision(unrelatedKey, "job-a")).toBe("job-b")
  })

  it("force 保存始终使用调用时明确指定的 revision", () => {
    acknowledgeSavedRevision(key, "rev-a", "rev-a", "rev-b")
    expect(resolveAcknowledgedSaveRevision(key, "rev-external", true)).toBe("rev-external")
  })
})
