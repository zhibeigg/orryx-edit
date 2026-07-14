import { create } from "zustand"
import type { AiJob, AiOperation } from "@/lib/ai-jobs"
import type { CloudDraft, CloudDraftVersion } from "@/lib/cloud-drafts"
import type { AiJobEvent, AiProviderOption, ReleaseTransaction, ServerHistoryEntry, ServerSnapshot } from "@/lib/workbench-api"
import type { FileReviewStatus } from "./workbench-utils"

export type WorkbenchPane = "context" | "ai" | "review"

interface WorkbenchState {
  accountId: string
  workspaceId: string
  serverInstanceId: string
  snapshots: ServerSnapshot[]
  history: ServerHistoryEntry[]
  drafts: CloudDraft[]
  versions: CloudDraftVersion[]
  providers: AiProviderOption[]
  selectedDraftId: string | null
  selectedVersionId: string | null
  selectedFilePath: string | null
  operation: AiOperation
  prompt: string
  providerId: string
  model: string
  activeJob: AiJob | null
  jobEvents: AiJobEvent[]
  fileReviews: Record<string, FileReviewStatus>
  releaseTransaction: ReleaseTransaction | null
  mobilePane: WorkbenchPane
  setIdentity: (accountId: string, workspaceId: string, serverInstanceId: string) => void
  setSnapshots: (snapshots: ServerSnapshot[]) => void
  setHistory: (history: ServerHistoryEntry[]) => void
  setDrafts: (drafts: CloudDraft[]) => void
  setVersions: (versions: CloudDraftVersion[]) => void
  setProviders: (providers: AiProviderOption[]) => void
  selectDraft: (id: string | null) => void
  selectVersion: (id: string | null) => void
  selectFile: (path: string | null) => void
  setOperation: (operation: AiOperation) => void
  setPrompt: (prompt: string) => void
  setProvider: (providerId: string, model: string) => void
  setModel: (model: string) => void
  setActiveJob: (job: AiJob | null) => void
  setJobEvents: (events: AiJobEvent[]) => void
  reviewFile: (path: string, status: FileReviewStatus) => void
  resetReviews: () => void
  setReleaseTransaction: (transaction: ReleaseTransaction | null) => void
  setMobilePane: (pane: WorkbenchPane) => void
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  accountId: "",
  workspaceId: "",
  serverInstanceId: "",
  snapshots: [],
  history: [],
  drafts: [],
  versions: [],
  providers: [],
  selectedDraftId: null,
  selectedVersionId: null,
  selectedFilePath: null,
  operation: "GENERATE",
  prompt: "",
  providerId: "",
  model: "",
  activeJob: null,
  jobEvents: [],
  fileReviews: {},
  releaseTransaction: null,
  mobilePane: "context",
  setIdentity: (accountId, workspaceId, serverInstanceId) => set({ accountId, workspaceId, serverInstanceId }),
  setSnapshots: (snapshots) => set({ snapshots }),
  setHistory: (history) => set({ history }),
  setDrafts: (drafts) => set({ drafts }),
  setVersions: (versions) => set({ versions }),
  setProviders: (providers) => set({ providers }),
  selectDraft: (selectedDraftId) => set({ selectedDraftId, selectedVersionId: null, selectedFilePath: null, versions: [], fileReviews: {} }),
  selectVersion: (selectedVersionId) => set({ selectedVersionId, selectedFilePath: null, fileReviews: {} }),
  selectFile: (selectedFilePath) => set({ selectedFilePath }),
  setOperation: (operation) => set({ operation }),
  setPrompt: (prompt) => set({ prompt }),
  setProvider: (providerId, model) => set({ providerId, model }),
  setModel: (model) => set({ model }),
  setActiveJob: (activeJob) => set({ activeJob }),
  setJobEvents: (jobEvents) => set({ jobEvents }),
  reviewFile: (path, status) => set((state) => ({ fileReviews: { ...state.fileReviews, [path]: status } })),
  resetReviews: () => set({ fileReviews: {} }),
  setReleaseTransaction: (releaseTransaction) => set({ releaseTransaction }),
  setMobilePane: (mobilePane) => set({ mobilePane }),
}))
