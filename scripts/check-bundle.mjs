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

for (const required of [/^vendor-monaco-.*\.js$/, /^monaco-loader-.*\.js$/, /^editor\.worker-.*\.js$/, /^json\.worker-.*\.js$/]) {
  if (!files.some((name) => required.test(name))) throw new Error(`缺少本地 Monaco 资产: ${required}`)
}
for (const forbidden of [/^css\.worker-.*\.js$/, /^html\.worker-.*\.js$/, /^ts\.worker-.*\.js$/]) {
  const file = files.find((name) => forbidden.test(name))
  if (file) throw new Error(`当前编辑器未使用该 Monaco worker，不应打包: ${file}`)
}

const monacoVendor = files.find((name) => /^vendor-monaco-.*\.js$/.test(name))
const monacoLoader = files.find((name) => /^monaco-loader-.*\.js$/.test(name))
const monacoVendorSource = await readFile(resolve(assetsDir, monacoVendor), "utf8")
if (monacoVendorSource.includes(monacoLoader)) {
  throw new Error(`${monacoVendor} 不应反向引用 ${monacoLoader}，否则动态加载会形成循环 chunk`)
}

const radixVendor = files.find((name) => /^vendor-radix-.*\.js$/.test(name))
const tooltipBundle = files.find((name) => /^tooltip-.*\.js$/.test(name))
if (!radixVendor || !tooltipBundle) throw new Error("缺少 Radix Tooltip 生产资产")
const radixVendorSource = await readFile(resolve(assetsDir, radixVendor), "utf8")
if (radixVendorSource.includes(tooltipBundle)) {
  throw new Error(`${radixVendor} 不应反向引用 ${tooltipBundle}，否则 Tooltip 会形成循环 chunk`)
}

console.log("Bundle budgets passed")
