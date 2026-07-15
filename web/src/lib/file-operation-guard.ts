export type FilePathMatcher = (path: string) => boolean

interface ActiveFileOperation {
  workspaceId: string
  matches: FilePathMatcher
}

const activeOperations = new Map<symbol, ActiveFileOperation>()
const operationEpochs = new Map<string, number>()

export function fileOperationEpoch(workspaceId: string): number {
  return operationEpochs.get(workspaceId) ?? 0
}

export function acquireFileOperationLock(workspaceId: string, matches: FilePathMatcher): () => void {
  if ([...activeOperations.values()].some((operation) => operation.workspaceId === workspaceId)) {
    throw new Error("当前工作区已有文件生命周期操作正在执行，请稍后重试。")
  }

  const key = Symbol("file-operation")
  operationEpochs.set(workspaceId, fileOperationEpoch(workspaceId) + 1)
  activeOperations.set(key, { workspaceId, matches })
  return () => {
    activeOperations.delete(key)
  }
}

export function isFileOperationBlocked(workspaceId: string, path: string): boolean {
  return [...activeOperations.values()].some(
    (operation) => operation.workspaceId === workspaceId && operation.matches(path),
  )
}

export function resetFileOperationGuardsForTests() {
  activeOperations.clear()
  operationEpochs.clear()
}
