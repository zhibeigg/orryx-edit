import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, CircleAlert, CloudOff, History, PanelsTopLeft } from "lucide-react"
import { ContextPanel } from "@/features/workbench/ContextPanel"
import { AiOperationsPanel } from "@/features/workbench/AiOperationsPanel"
import { ReviewApplyPanel } from "@/features/workbench/ReviewApplyPanel"
import { useWorkbenchStore, type WorkbenchPane } from "@/features/workbench/workbench-store"
import { evaluateReleaseGate, parseArtifactDiagnostics, releaseStatusDescriptor } from "@/features/workbench/workbench-utils"
import { accountApi, resolveAccount } from "@/lib/account-api"
import { ApiError, apiErrorMessage } from "@/lib/api-client"
import { resolveCloudDrafts, type CloudDraftFileChange, type CloudDraftVersion } from "@/lib/cloud-drafts"
import { cacheRecentPrompt, cacheServerValue, readCachedServerValue, readRecentPrompt } from "@/lib/workbench-cache"
import { createIdempotencyKey, resolveJobEvents, resolveList, resolveProviders, resolveServerHistory, workbenchApi, type AiJobEvent, type ServerHistoryEntry, type ServerSnapshot } from "@/lib/workbench-api"

export function WorkbenchPage({ workspaceId, serverInstanceId }: { workspaceId: string; serverInstanceId: string }) {
  const store = useWorkbenchStore()
  const [booting, setBooting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [submittingJob, setSubmittingJob] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [accountMissing, setAccountMissing] = useState(false)
  const [entitled, setEntitled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [networkNote, setNetworkNote] = useState<string | null>(null)

  const selectedDraft = store.drafts.find((item) => item.id === store.selectedDraftId) ?? null
  const selectedVersion = store.versions.find((item) => item.id === store.selectedVersionId) ?? null
  const selectedFile = selectedVersion?.files?.find((item) => item.path === store.selectedFilePath) ?? null
  const baseSnapshot = store.snapshots.find((item) => item.id === selectedDraft?.baseSnapshotId) ?? null
  const originalContent = baseSnapshot?.files?.find((item) => item.path === selectedFile?.path)?.content ?? ""
  const artifact = useMemo(() => parseArtifactDiagnostics(store.activeJob?.runnerResult), [store.activeJob?.runnerResult])
  const expectedBaseManifest = baseSnapshot?.manifestRevision ?? ""
  const targetManifest = selectedVersion?.manifestRevision ?? ""
  const transactionActive = store.releaseTransaction ? !releaseStatusDescriptor(store.releaseTransaction.status).terminal : false
  const releaseGate = evaluateReleaseGate({ draft: selectedDraft, version: selectedVersion, artifact, fileReviews: store.fileReviews, expectedBaseManifest, targetManifest, transactionActive })

  const loadArtifactForVersion = useCallback(async (draftId: string, version: CloudDraftVersion, versions: CloudDraftVersion[]) => {
    const state = useWorkbenchStore.getState()
    if (version.source !== "AI") {
      state.setActiveJob(null)
      state.setJobEvents([])
      return
    }
    try {
      const response = await workbenchApi.jobs(serverInstanceId, draftId)
      const previous = versions.find((item) => item.versionNumber === version.versionNumber - 1)
      const jobs = resolveList(response, "jobs")
        .filter((job) => job.status === "SUCCEEDED" && job.draftId === draftId)
        .filter((job) => version.versionNumber === 1 ? !job.baseVersionId : job.baseVersionId === previous?.id)
        .sort((a, b) => new Date(b.finishedAt ?? b.updatedAt).getTime() - new Date(a.finishedAt ?? a.updatedAt).getTime())
      const job = jobs[0] ?? null
      state.setActiveJob(job)
      if (!job) {
        state.setJobEvents([])
        return
      }
      const events = resolveJobEvents(await workbenchApi.jobEvents(job.id))
      state.setJobEvents(events.length ? events : [jobEvent(job)])
    } catch {
      state.setActiveJob(null)
      state.setJobEvents([])
    }
  }, [serverInstanceId])

  const loadDraftVersions = useCallback(async (draftId: string, preferredVersionId?: string) => {
    const response = await workbenchApi.draftVersions(draftId)
    const versions = resolveList(response, "versions").sort((a, b) => b.versionNumber - a.versionNumber)
    const state = useWorkbenchStore.getState()
    state.setVersions(versions)
    const selected = versions.find((item) => item.id === preferredVersionId) ?? versions[0]
    state.selectVersion(selected?.id ?? null)
    if (!selected) return
    const full = selected.files ? selected : await workbenchApi.draftVersion(draftId, selected.id)
    if (full !== selected) state.setVersions(versions.map((item) => item.id === full.id ? full : item))
    state.selectFile(full.files?.[0]?.path ?? null)
    await Promise.all((full.files ?? []).map((file) => cacheServerValue({ accountId: state.accountId, workspaceId, serverInstanceId, draftId, versionId: full.id, path: file.path }, file)))
    await loadArtifactForVersion(draftId, full, versions)
  }, [loadArtifactForVersion, serverInstanceId, workspaceId])

  const loadServerData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [snapshotResult, draftResult, providerResult, historyResult] = await Promise.allSettled([
      workbenchApi.snapshots(serverInstanceId),
      workbenchApi.drafts(serverInstanceId),
      workbenchApi.providers(),
      workbenchApi.history(serverInstanceId),
    ])
    const state = useWorkbenchStore.getState()

    if (snapshotResult.status === "fulfilled") state.setSnapshots(resolveList(snapshotResult.value, "snapshots").sort(byCreatedAtDesc))
    if (draftResult.status === "fulfilled") state.setDrafts(resolveCloudDrafts(draftResult.value).sort(byUpdatedAtDesc))
    if (providerResult.status === "fulfilled") {
      const providers = resolveProviders(providerResult.value)
      state.setProviders(providers)
      const first = providers.find((item) => item.enabled)
      if (!state.providerId && first) state.setProvider(first.providerId ?? first.id, first.defaultModel ?? first.models[0] ?? "")
    }
    if (historyResult.status === "fulfilled") state.setHistory(resolveServerHistory(historyResult.value).sort(byCreatedAtDesc))
    else if (snapshotResult.status === "fulfilled") state.setHistory(resolveList(snapshotResult.value, "snapshots").map(snapshotHistory).sort(byCreatedAtDesc))

    const requiredFailure = [snapshotResult, draftResult].find((result) => result.status === "rejected")
    if (requiredFailure?.status === "rejected") setError(apiErrorMessage(requiredFailure.reason, "服务器上下文加载失败。"))
    const optionalFailures = [providerResult, historyResult].filter((result) => result.status === "rejected").length
    setNetworkNote(optionalFailures ? "部分扩展端点暂不可用；核心草稿数据已优先加载。网络恢复后可刷新重试。" : null)
    setLoading(false)
  }, [serverInstanceId])

  useEffect(() => {
    let active = true
    const boot = async () => {
      setBooting(true)
      setError(null)
      try {
        const [session, billing] = await Promise.all([accountApi.me(), accountApi.billingSummary()])
        if (!active) return
        const account = resolveAccount(session)
        if (!account) throw new Error("账户会话响应缺少账户信息。")
        const state = useWorkbenchStore.getState()
        state.setIdentity(account.id, workspaceId, serverInstanceId)
        setEntitled(Boolean(billing.permanentAi ?? billing.aiPermanent ?? billing.entitlements?.some((item) => item.type === "AI_EDITOR_PERMANENT")))
        state.setPrompt(await readRecentPrompt(account.id, workspaceId, serverInstanceId))
        await loadServerData()
      } catch (cause) {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) setAccountMissing(true)
        else setError(apiErrorMessage(cause, "工作台初始化失败。"))
      } finally {
        if (active) setBooting(false)
      }
    }
    void boot()
    return () => { active = false }
  }, [loadServerData, serverInstanceId, workspaceId])

  const selectDraft = async (draftId: string) => {
    store.selectDraft(draftId)
    setError(null)
    try {
      await loadDraftVersions(draftId)
    } catch (cause) {
      setError(apiErrorMessage(cause, "草稿版本加载失败。"))
    }
  }

  const selectVersion = async (versionId: string) => {
    if (!selectedDraft) return
    setError(null)
    try {
      const cachedVersion = store.versions.find((item) => item.id === versionId)
      const full = cachedVersion?.files ? cachedVersion : await workbenchApi.draftVersion(selectedDraft.id, versionId)
      const versions = store.versions.map((item) => item.id === full.id ? full : item)
      store.setVersions(versions)
      store.selectVersion(full.id)
      store.selectFile(full.files?.[0]?.path ?? null)
      await Promise.all((full.files ?? []).map((file) => cacheServerValue({ accountId: store.accountId, workspaceId, serverInstanceId, draftId: selectedDraft.id, versionId: full.id, path: file.path }, file)))
      await loadArtifactForVersion(selectedDraft.id, full, versions)
    } catch (cause) {
      const fallback = await Promise.all((store.versions.find((item) => item.id === versionId)?.files ?? []).map(async (file) => (await readCachedServerValue<CloudDraftFileChange>({ accountId: store.accountId, workspaceId, serverInstanceId, draftId: selectedDraft.id, versionId, path: file.path }))?.value ?? file))
      if (fallback.length) {
        store.setVersions(store.versions.map((item) => item.id === versionId ? { ...item, files: fallback } : item))
        store.selectVersion(versionId)
        store.selectFile(fallback[0]?.path ?? null)
        setNetworkNote("当前展示上次从服务端读取的缓存副本；这不表示离线更改已同步，也不能离线发布。")
      } else setError(apiErrorMessage(cause, "版本详情加载失败。"))
    }
  }

  const createDraft = async (baseSnapshotId: string, title: string) => {
    setError(null)
    try {
      const draft = await workbenchApi.createDraft({ serverInstanceId, baseSnapshotId, title })
      store.setDrafts([draft, ...store.drafts.filter((item) => item.id !== draft.id)])
      await selectDraft(draft.id)
    } catch (cause) {
      setError(apiErrorMessage(cause, "创建草稿失败。"))
    }
  }

  const restoreHistory = async (snapshotId: string) => {
    setError(null)
    try {
      const draft = await workbenchApi.restoreFromHistory(serverInstanceId, snapshotId, { title: `从历史恢复 ${new Date().toLocaleString("zh-CN")}` })
      store.setDrafts([draft, ...store.drafts.filter((item) => item.id !== draft.id)])
      await selectDraft(draft.id)
    } catch (cause) {
      setError(apiErrorMessage(cause, "从历史创建草稿失败。生产环境未被修改。"))
    }
  }

  const submitJob = async () => {
    if (!selectedDraft) return
    setSubmittingJob(true)
    setError(null)
    await cacheRecentPrompt(store.accountId, workspaceId, serverInstanceId, store.prompt)
    try {
      let job = await workbenchApi.createJob({ serverInstanceId, draftId: selectedDraft.id, baseVersionId: selectedVersion?.id, operation: store.operation, prompt: store.prompt.trim(), providerId: store.providerId, model: store.model, idempotencyKey: createIdempotencyKey("ai") })
      store.setActiveJob(job)
      store.setJobEvents([jobEvent(job)])
      while (!isJobTerminal(job.status)) {
        await delay(1500)
        job = await workbenchApi.job(job.id)
        store.setActiveJob(job)
        try {
          const events = resolveJobEvents(await workbenchApi.jobEvents(job.id))
          store.setJobEvents(events.length ? events : [jobEvent(job)])
        } catch {
          store.setJobEvents([...store.jobEvents.filter((item) => item.type !== job.status), jobEvent(job)])
        }
      }
      if (job.status === "SUCCEEDED") {
        const refreshedDraft = await workbenchApi.draft(selectedDraft.id)
        store.setDrafts(store.drafts.map((item) => item.id === refreshedDraft.id ? refreshedDraft : item))
        await loadDraftVersions(selectedDraft.id, parseArtifactDiagnostics(job.runnerResult).draftVersionId)
        store.setMobilePane("review")
      } else if (job.status === "FAILED") setError(`${job.errorCode ?? "AI_JOB_FAILED"}：${job.errorMessage ?? "AI 任务失败，请检查 Provider 与任务输入。"}`)
    } catch (cause) {
      setError(apiErrorMessage(cause, "AI Job 创建或轮询失败。"))
    } finally {
      setSubmittingJob(false)
    }
  }

  const cancelJob = async () => {
    if (!store.activeJob) return
    try {
      store.setActiveJob(await workbenchApi.cancelJob(store.activeJob.id))
    } catch (cause) {
      setError(apiErrorMessage(cause, "取消 AI Job 失败。"))
    }
  }

  const publish = async () => {
    if (!selectedDraft || !selectedVersion || !releaseGate.allowed) return
    setPublishing(true)
    setError(null)
    try {
      const created = await workbenchApi.createRelease({ serverInstanceId, draftId: selectedDraft.id, draftVersionId: selectedVersion.id, expectedCurrentVersion: selectedDraft.currentVersion, expectedBaseManifestRevision: expectedBaseManifest }, createIdempotencyKey("release"))
      let transaction = created.transaction
      store.setReleaseTransaction(transaction)
      while (!releaseStatusDescriptor(transaction.status).terminal && transaction.status !== "RECOVERY_REQUIRED") {
        await delay(1500)
        transaction = await workbenchApi.releaseTransaction(transaction.id)
        store.setReleaseTransaction(transaction)
      }
      await loadServerData()
    } catch (cause) {
      setError(apiErrorMessage(cause, "发布事务创建或轮询失败。草稿仍保留，生产未通过旧文件写入修改。"))
    } finally {
      setPublishing(false)
    }
  }

  const rollback = async () => {
    if (!store.releaseTransaction) return
    setError(null)
    try {
      const transaction = await workbenchApi.rollbackRelease(store.releaseTransaction.id)
      store.setReleaseTransaction(transaction)
    } catch (cause) {
      setError(apiErrorMessage(cause, "回滚请求失败。请刷新事务状态并检查服务器日志。"))
    }
  }

  if (booting) return <main id="main-content" className="route-loading" aria-busy="true" aria-live="polite">正在验证账户会话并加载服务器工作台…</main>
  if (accountMissing) return <main id="main-content" className="workbench-access-boundary"><section><CloudOff aria-hidden="true" /><p className="eyebrow">ACCOUNT SESSION REQUIRED</p><h1>工作台需要账户会话</h1><p>当前浏览器没有有效账户会话。工作台不会回退到旧 License 或 WebSocket 写入流程。</p><a className="industrial-button industrial-button--primary" href="/portal"><ArrowLeft aria-hidden="true" />返回 Portal 登录</a></section></main>

  return (
    <main id="main-content" className="workbench-shell">
      <header className="workbench-topbar"><div><a href="/portal" className="workbench-back-link"><ArrowLeft aria-hidden="true" />Portal</a><span aria-hidden="true">/</span><strong>Server Workbench</strong></div><div><span><PanelsTopLeft aria-hidden="true" />三栏审核模式</span><span><History aria-hidden="true" />Server-first drafts</span></div></header>
      {(error || networkNote) && <div className={`workbench-global-status ${error ? "is-error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}><CircleAlert aria-hidden="true" /><span>{error ?? networkNote}</span>{networkNote && <button type="button" onClick={() => void loadServerData()}>重新拉取</button>}</div>}
      <nav className="workbench-mobile-tabs" aria-label="工作台栏切换">{(["context", "ai", "review"] as WorkbenchPane[]).map((pane) => <button key={pane} type="button" aria-current={store.mobilePane === pane ? "page" : undefined} onClick={() => store.setMobilePane(pane)}>{pane === "context" ? "上下文 / 历史" : pane === "ai" ? "AI 操作" : "审核 / 发布"}</button>)}</nav>
      <div className="workbench-grid" data-mobile-pane={store.mobilePane}>
        <ContextPanel workspaceId={workspaceId} serverInstanceId={serverInstanceId} snapshots={store.snapshots} history={store.history} drafts={store.drafts} selectedDraftId={store.selectedDraftId} loading={loading} onSelectDraft={(id) => void selectDraft(id)} onCreateDraft={createDraft} onRestore={restoreHistory} onRefresh={() => void loadServerData()} />
        <AiOperationsPanel entitled={entitled} draftSelected={Boolean(selectedDraft)} providers={store.providers} operation={store.operation} prompt={store.prompt} providerId={store.providerId} model={store.model} job={store.activeJob} events={store.jobEvents} submitting={submittingJob} onOperation={store.setOperation} onPrompt={store.setPrompt} onProvider={store.setProvider} onModel={store.setModel} onSubmit={submitJob} onCancel={cancelJob} />
        <ReviewApplyPanel draft={selectedDraft} versions={store.versions} version={selectedVersion} selectedFile={selectedFile} originalContent={originalContent} artifact={artifact} fileReviews={store.fileReviews} expectedBaseManifest={expectedBaseManifest} targetManifest={targetManifest} releaseGate={releaseGate} transaction={store.releaseTransaction} publishing={publishing} onSelectVersion={(id) => void selectVersion(id)} onSelectFile={store.selectFile} onReview={store.reviewFile} onPublish={publish} onRollback={rollback} />
      </div>
    </main>
  )
}

const byCreatedAtDesc = <T extends { createdAt: string }>(a: T, b: T) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
const byUpdatedAtDesc = <T extends { updatedAt: string }>(a: T, b: T) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
const isJobTerminal = (status: string) => status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED"
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
const jobEvent = (job: { status: string; updatedAt: string; errorMessage?: string | null }): AiJobEvent => ({ type: job.status, message: job.errorMessage ?? `任务状态更新为 ${job.status}`, createdAt: job.updatedAt })
const snapshotHistory = (snapshot: ServerSnapshot): ServerHistoryEntry => ({ id: snapshot.id, kind: "SNAPSHOT", source: snapshot.source, status: snapshot.status ?? "AVAILABLE", manifestRevision: snapshot.manifestRevision, createdAt: snapshot.createdAt, snapshotId: snapshot.id })
