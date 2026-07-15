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
]) {
  if (!compose.includes(expected)) throw new Error(`docker-compose.yml 缺少 ${expected}`)
}

function appEnvironment(source) {
  const lines = source.split(/\r?\n/)
  const appIndex = lines.findIndex((line) => /^  app:\s*$/.test(line))
  if (appIndex < 0) throw new Error("docker-compose.yml 缺少 services.app")

  const environmentIndex = lines.findIndex((line, index) => (
    index > appIndex && /^    environment:\s*$/.test(line)
  ))
  if (environmentIndex < 0) throw new Error("docker-compose.yml 缺少 services.app.environment")

  const variables = new Map()
  for (let index = environmentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^    \S/.test(line)) break
    const match = line.match(/^      ([A-Z][A-Z0-9_]*):\s*(.*)$/)
    if (match) variables.set(match[1], match[2])
  }
  return variables
}

const composeEnvironment = appEnvironment(compose)
const requiredAppEnvironment = [
  "KETHER_DOCS_SYNC_ENABLED",
  "KETHER_DOCS_SYNC_INTERVAL_HOURS",
  "ACCOUNTS_ENABLED",
  "CLOUD_DRAFTS_ENABLED",
  "ACCOUNT_SESSION_TTL_HOURS",
  "ACCOUNT_COOKIE_SECURE",
  "ACCOUNT_COOKIE_DOMAIN",
  "EDITOR_PROTOCOL_V2_ENABLED",
  "EDITOR_V2_WRITES_ENABLED",
  "RELEASE_TRANSACTIONS_ENABLED",
  "RELEASE_PUBLIC_BASE_URL",
  "RELEASE_ALLOW_LOCAL_HTTP",
  "RELEASE_SIGNING_PRIVATE_KEY_PKCS8_BASE64",
  "RELEASE_SIGNING_PUBLIC_KEY_X509_BASE64",
  "RELEASE_TRANSFER_TTL_SECONDS",
  "RELEASE_TRANSACTION_LEASE_SECONDS",
  "RELEASE_READINESS_TIMEOUT_SECONDS",
  "RELEASE_MAX_BYTES",
  "AI_WORKBENCH_ENABLED",
  "AI_PROVIDER_ID",
  "AI_PROVIDER_BASE_URL",
  "AI_PROVIDER_API_KEY",
  "AI_PROVIDER_MODEL",
  "AI_PROVIDER_REQUEST_TIMEOUT_SECONDS",
  "AI_PROVIDER_MAX_RESPONSE_BYTES",
  "AI_INPUT_COST_PER_MILLION_CENTS",
  "AI_OUTPUT_COST_PER_MILLION_CENTS",
  "AI_USAGE_RESERVATION_CENTS",
  "RUNNER_ENABLED",
  "RUNNER_ENDPOINT",
  "RUNNER_SHARED_SECRET",
  "RUNNER_REQUEST_TIMEOUT_SECONDS",
  "RUNNER_MAX_RESPONSE_BYTES",
]
for (const variable of requiredAppEnvironment) {
  const value = composeEnvironment.get(variable)
  if (value === undefined) throw new Error(`docker-compose.yml services.app.environment 缺少 ${variable}`)
  if (!value.includes(`\${${variable}`)) {
    throw new Error(`docker-compose.yml services.app.environment 未从宿主环境透传 ${variable}`)
  }
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
if (ci.includes('ls artifacts/*.jar')) {
  throw new Error("CI E2E 禁止使用可同时匹配 plain 与发行包的模糊 JAR 选择")
}
for (const expected of [
  "!server/build/libs/orryx-editor-server-*-plain.jar",
  'JAR="artifacts/orryx-editor-server-$VERSION_VALUE.jar"',
]) {
  if (!ci.includes(expected)) throw new Error(`CI 缺少确定性发行 JAR 选择: ${expected}`)
}
console.log("Deployment configuration validation passed")
