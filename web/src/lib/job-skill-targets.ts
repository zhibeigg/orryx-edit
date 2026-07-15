import type { FileTreeNode } from "@/types"

export interface JobSkillTarget {
  name: string
  path: string
}

export type JobSkillTargetResolution =
  | { status: "found"; target: JobSkillTarget }
  | { status: "ambiguous"; targets: readonly JobSkillTarget[] }
  | { status: "missing" }

export type JobSkillTargetIndex = ReadonlyMap<string, readonly JobSkillTarget[]>

function normalizedFilePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "")
}

function skillTargetFromNode(node: FileTreeNode): JobSkillTarget | null {
  if (node.isDirectory) return null
  const path = normalizedFilePath(node.path)
  if (!path.startsWith("skills/") || !path.endsWith(".yml")) return null

  const fileName = path.slice(path.lastIndexOf("/") + 1, -4)
  return fileName ? { name: fileName, path } : null
}

export function buildJobSkillTargetIndex(nodes: readonly FileTreeNode[]): JobSkillTargetIndex {
  const targetsByPath = new Map<string, JobSkillTarget>()

  const visit = (node: FileTreeNode) => {
    const target = skillTargetFromNode(node)
    if (target) targetsByPath.set(target.path, target)
    node.children?.forEach(visit)
  }

  nodes.forEach(visit)

  const index = new Map<string, JobSkillTarget[]>()
  const targets = Array.from(targetsByPath.values()).sort((left, right) => (
    left.name.localeCompare(right.name, "zh-CN") || left.path.localeCompare(right.path, "zh-CN")
  ))

  for (const target of targets) {
    const matching = index.get(target.name)
    if (matching) matching.push(target)
    else index.set(target.name, [target])
  }

  return index
}

export function resolveJobSkillTarget(
  skill: string,
  index: JobSkillTargetIndex,
): JobSkillTargetResolution {
  const targets = index.get(skill)
  if (!targets || targets.length === 0) return { status: "missing" }
  if (targets.length === 1) return { status: "found", target: targets[0] }
  return { status: "ambiguous", targets }
}
