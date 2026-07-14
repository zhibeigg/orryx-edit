import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const read = (path) => readFile(resolve(root, path), "utf8")
const [dockerfile, compose, service, ci, release] = await Promise.all([
  read("Dockerfile"), read("docker-compose.yml"), read("deploy/orryx-editor.service"),
  read(".github/workflows/ci.yml"), read(".github/workflows/release.yml"),
])

for (const expected of ["COPY scripts ./scripts", "USER 10001:10001", "DEPLOYMENT_MODE=container", "HEALTHCHECK"]) {
  if (!dockerfile.includes(expected)) throw new Error(`Dockerfile 缺少 ${expected}`)
}
for (const expected of [
  "read_only: true",
  "no-new-privileges:true",
  "condition: service_healthy",
  "KETHER_DOCS_SYNC_ENABLED",
  "KETHER_DOCS_SYNC_INTERVAL_HOURS",
  "ACCOUNTS_ENABLED",
  "ACCOUNT_SESSION_TTL_HOURS",
  "ACCOUNT_COOKIE_SECURE",
  "ACCOUNT_COOKIE_DOMAIN",
]) {
  if (!compose.includes(expected)) throw new Error(`docker-compose.yml 缺少 ${expected}`)
}
for (const expected of ["NoNewPrivileges=true", "ProtectSystem=strict", "ReadWritePaths="]) {
  if (!service.includes(expected)) throw new Error(`systemd service 缺少 ${expected}`)
}
if (service.includes("MemoryDenyWriteExecute=true")) throw new Error("JVM service 不能启用 MemoryDenyWriteExecute")

for (const workflow of [ci, release]) {
  const uses = [...workflow.matchAll(/^\s*- uses:\s*([^\s#]+)/gm)].map((match) => match[1])
  for (const action of uses) {
    const revision = action.split("@")[1]
    if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error(`Action 未固定到 commit SHA: ${action}`)
  }
}
if (!release.includes("update-manifest.json") || !release.includes(".jar.sha256")) {
  throw new Error("Release workflow 缺少更新清单或 SHA-256 资产")
}
console.log("Deployment configuration validation passed")
