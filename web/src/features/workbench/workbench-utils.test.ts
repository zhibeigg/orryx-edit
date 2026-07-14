import { describe, expect, it } from "vitest"
import { aiStatusDescriptor, evaluateReleaseGate, parseArtifactDiagnostics, releaseStatusDescriptor } from "./workbench-utils"

const draft = {
  id: "draft-1",
  serverInstanceId: "server-1",
  baseSnapshotId: "snapshot-1",
  title: "测试草稿",
  status: "OPEN",
  currentVersion: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

const version = {
  id: "version-2",
  draftId: "draft-1",
  versionNumber: 2,
  source: "AI" as const,
  manifestRevision: "target",
  createdAt: "2026-01-01T00:00:00Z",
  files: [{ changeType: "UPSERT" as const, path: "skills/fire.yml", content: "enabled: true" }],
}

const cleanArtifact = parseArtifactDiagnostics({
  status: "completed",
  result: { status: "ok", diagnostics: [], checks: [{ code: "SCHEMA", status: "pass", message: "校验通过" }], references: [], requirements: [] },
})

describe("工作台纯函数", () => {
  it("按 Creation Suite 1.1.0 真实合同解析 diagnostics、checks、references 与 requirements", () => {
    expect(parseArtifactDiagnostics({ status: "completed", result: {
      status: "error",
      draftVersionId: "version-2",
      diagnostics: [{ severity: "error", message: "缺少字段", path: "skills/fire.yml", line: 4, code: "SCHEMA" }],
      checks: [{ code: "KETHER_SCHEMA", status: "failed", message: "校验失败" }],
      references: [{ source: "skills/fire.yml", target: "stations/fire.yml", kind: "station", required: true }],
      requirements: [{ code: "SERVER_PREFLIGHT_REQUIRED", message: "需要隔离服预检" }],
    } })).toEqual({
      available: true,
      status: "error",
      draftVersionId: "version-2",
      diagnostics: [{ severity: "error", message: "缺少字段", path: "skills/fire.yml", line: 4, code: "SCHEMA" }],
      checks: [{ name: "KETHER_SCHEMA", status: "failed", detail: "校验失败" }],
      references: ["station: skills/fire.yml → stations/fire.yml"],
      requirements: ["SERVER_PREFLIGHT_REQUIRED: 需要隔离服预检"],
    })
  })

  it("映射 AI 与发布状态", () => {
    expect(aiStatusDescriptor("RUNNING")).toMatchObject({ tone: "progress", terminal: false })
    expect(releaseStatusDescriptor("READINESS_PENDING")).toMatchObject({ tone: "warning", terminal: false })
    expect(releaseStatusDescriptor("ROLLED_BACK")).toMatchObject({ tone: "warning", terminal: true })
  })

  it("仅允许审核通过且 Runner 门禁通过的当前 AI 草稿版本发布", () => {
    expect(evaluateReleaseGate({
      draft,
      version,
      artifact: cleanArtifact,
      fileReviews: { "skills/fire.yml": "APPROVED" },
      expectedBaseManifest: "base",
      targetManifest: "target",
      transactionActive: false,
    })).toEqual({ allowed: true, reasons: [] })

    const blocked = evaluateReleaseGate({
      draft,
      version: { ...version, versionNumber: 1 },
      artifact: parseArtifactDiagnostics({ result: {
        status: "error",
        diagnostics: [{ severity: "error", code: "SCHEMA", message: "失败" }],
        checks: [{ code: "SCHEMA", status: "failed", message: "失败" }],
        requirements: [{ code: "SERVER_PREFLIGHT_REQUIRED", message: "需要预检" }],
        references: [],
      } }),
      fileReviews: {},
      expectedBaseManifest: "",
      targetManifest: "target",
      transactionActive: true,
    })
    expect(blocked.allowed).toBe(false)
    expect(blocked.reasons).toContain("只能发布草稿的当前版本。")
    expect(blocked.reasons).toContain("已有发布事务正在执行。")
    expect(blocked.reasons).toContain("Runner 仍有 1 个 error diagnostics。")
    expect(blocked.reasons).toContain("Runner 仍有 1 个未通过 checks。")
    expect(blocked.reasons).toContain("仍有 1 个 requirements 未满足。")
  })

  it("AI 版本在缺少 Runner 结果时 fail-closed", () => {
    const gate = evaluateReleaseGate({
      draft,
      version,
      artifact: parseArtifactDiagnostics(undefined),
      fileReviews: { "skills/fire.yml": "APPROVED" },
      expectedBaseManifest: "base",
      targetManifest: "target",
      transactionActive: false,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.reasons).toContain("当前 AI 版本缺少可验证的 Runner 结果。")
  })
})
