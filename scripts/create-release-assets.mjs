import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const version = (await readFile(resolve(root, "VERSION"), "utf8")).trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION 无效: ${version}`)
const jarName = `orryx-editor-${version}.jar`
const sourceJar = resolve(root, `server/build/libs/orryx-editor-server-${version}.jar`)
const releaseDir = resolve(root, "release")
await mkdir(releaseDir, { recursive: true })
const jar = await readFile(sourceJar)
const sha256 = createHash("sha256").update(jar).digest("hex")
await copyFile(sourceJar, resolve(releaseDir, jarName))
await writeFile(resolve(releaseDir, `${jarName}.sha256`), `${sha256}  ${jarName}\n`)
await writeFile(resolve(releaseDir, "update-manifest.json"), `${JSON.stringify({ version, artifact: jarName, sha256 }, null, 2)}\n`)
for (const file of ["start.sh", "start.ps1", ".env.example", "README.md", "PLUGIN_API.md"]) {
  await copyFile(resolve(root, file), resolve(releaseDir, file.replace(/^\./, "")))
}
console.log(`Release assets created for ${version}`)
