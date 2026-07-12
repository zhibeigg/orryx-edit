import { readdir, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

const roots = [resolve(import.meta.dirname, "../web/src"), resolve(import.meta.dirname, "../server/src/main/resources/static")]
const secretPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /UPDATE_GITHUB_TOKEN\s*[:=]\s*["'][^"']+["']/,
]

async function walk(directory) {
  const result = []
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name)
    const metadata = await stat(path)
    if (metadata.isDirectory()) result.push(...await walk(path))
    else if (/\.(?:js|mjs|cjs|ts|tsx|json|html|css)$/.test(name)) result.push(path)
  }
  return result
}

for (const root of roots) {
  for (const file of await walk(root)) {
    const source = await readFile(file, "utf8")
    for (const pattern of secretPatterns) {
      if (pattern.test(source)) throw new Error(`前端产物疑似包含敏感凭据: ${file}`)
    }
  }
}
console.log("Frontend secret scan passed")
