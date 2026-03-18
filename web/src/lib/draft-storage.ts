import { get, set, del, keys } from "idb-keyval"

const DRAFT_PREFIX = "draft:"

export async function saveDraft(path: string, content: string) {
  await set(`${DRAFT_PREFIX}${path}`, {
    content,
    savedAt: Date.now(),
  })
}

export async function loadDraft(path: string): Promise<{ content: string; savedAt: number } | null> {
  return await get(`${DRAFT_PREFIX}${path}`) ?? null
}

export async function deleteDraft(path: string) {
  await del(`${DRAFT_PREFIX}${path}`)
}

export async function listDrafts(): Promise<string[]> {
  const allKeys = await keys()
  return (allKeys as string[])
    .filter((k) => k.startsWith(DRAFT_PREFIX))
    .map((k) => k.slice(DRAFT_PREFIX.length))
}

export async function clearAllDrafts() {
  const allKeys = await keys()
  for (const key of allKeys) {
    if ((key as string).startsWith(DRAFT_PREFIX)) {
      await del(key)
    }
  }
}
