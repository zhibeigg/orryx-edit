import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"

const root = resolve(import.meta.dirname, "../server/src/main/resources/static")
const port = Number(process.env.PORT ?? 19090)
const adminKey = process.env.E2E_ADMIN_KEY ?? "0123456789abcdef"
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" }

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
  if (url.pathname.startsWith("/api/admin/")) {
    if (request.headers.authorization !== `Bearer ${adminKey}`) return json(response, 401, { code: "UNAUTHORIZED" })
    if (url.pathname === "/api/admin/licenses") return json(response, 200, [])
    if (url.pathname === "/api/admin/stats") return json(response, 200, { servers: 0, browsers: 0, tokens: 0, licenses: 0 })
    if (url.pathname === "/api/admin/update/status") return json(response, 200, { currentVersion: "0.4.1", deployment: "source", launcherManaged: false, updateAvailable: false, activeUsers: 0 })
    if (url.pathname === "/api/admin/kether-docs/status" || url.pathname === "/api/admin/kether-docs/sync") return json(response, 200, {
      enabled: true,
      syncing: false,
      health: "UP_TO_DATE",
      source: "CACHE",
      channel: "stable",
      releaseId: "Orryx@2.43.114+94753d2f39461748ae64b84da7287740cedd514e",
      pluginVersion: "2.43.114",
      commit: "94753d2f39461748ae64b84da7287740cedd514e",
      schemaVersion: 3,
      schemaSha256: "0".repeat(64),
      schemaBytes: 948429,
      lastSuccessAt: Date.now(),
      nextAttemptAt: Date.now() + 43_200_000,
    })
    return json(response, 404, { code: "NOT_FOUND" })
  }
  if (url.pathname === "/health/ready") return json(response, 200, { status: "UP", version: "0.4.1" })
  if (url.pathname === "/api/actions-schema") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    response.end(await readFile(resolve(root, "actions-schema.json")))
    return
  }

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
  const candidate = resolve(root, relative)
  if (!candidate.startsWith(`${root}${sep}`) && candidate !== root) return json(response, 400, { code: "INVALID_PATH" })
  try {
    if ((await stat(candidate)).isFile()) {
      response.writeHead(200, { "Content-Type": types[extname(candidate)] ?? "application/octet-stream" })
      response.end(await readFile(candidate))
      return
    }
  } catch { }
  response.writeHead(200, { "Content-Type": "text/html" })
  response.end(await readFile(resolve(root, "index.html")))
})

server.listen(port, "127.0.0.1", () => console.log(`E2E mock server listening on ${port}`))
process.on("SIGTERM", () => server.close())
process.on("SIGINT", () => server.close())
