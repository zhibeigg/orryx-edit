import { readdir, stat, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const assetsDir = resolve(root, "server/src/main/resources/static/assets")
const files = await readdir(assetsDir)
const budgets = [
  [/^AdminPage-.*\.js$/, 120 * 1024],
  [/^PortalPage-.*\.js$/, 80 * 1024],
  [/^EditorRoute-.*\.js$/, 100 * 1024],
]

for (const [pattern, maximum] of budgets) {
  const file = files.find((name) => pattern.test(name))
  if (!file) throw new Error(`缺少 bundle: ${pattern}`)
  const size = (await stat(resolve(assetsDir, file))).size
  if (size > maximum) throw new Error(`${file} 为 ${size} bytes，超过预算 ${maximum}`)
}

for (const pagePattern of [/^AdminPage-.*\.js$/, /^PortalPage-.*\.js$/]) {
  const file = files.find((name) => pagePattern.test(name))
  const source = await readFile(resolve(assetsDir, file), "utf8")
  for (const forbidden of ["vendor-monaco", "vendor-flow", "vendor-three"]) {
    if (source.includes(forbidden)) throw new Error(`${file} 不应引用 ${forbidden}`)
  }
}

console.log("Bundle budgets passed")
