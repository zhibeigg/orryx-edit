import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = "6.3.0"
const COMMIT = "ae4bcf2c02e573e33f2c0dcbb02d89b8236e509b"
const BASELINE_REPOSITORY = "D:/code/taboolib"
const MODULE_ROOT = "module/minecraft/minecraft-kether"
const KOTLIN_ROOT = `${MODULE_ROOT}/src/main/kotlin`
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = resolve(root, `schemas/taboolib-${VERSION}`)

function git(...args) {
  return execFileSync("git", ["-C", BASELINE_REPOSITORY, ...args], { encoding: "utf8" }).trim()
}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function sourceAtCommit(path) {
  return git("show", `${COMMIT}:${path}`)
}

function kotlinFilesAtCommit() {
  return git("ls-tree", "-r", "--name-only", COMMIT, "--", KOTLIN_ROOT)
    .split(/\r?\n/)
    .filter((path) => path.endsWith(".kt"))
}

function quotedStrings(value) {
  return [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`))
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entry"
}

function relativeSource(path) {
  return path.slice(`${MODULE_ROOT}/`.length).replaceAll("\\", "/")
}

function extractParserGroups(files) {
  const groups = []
  for (const path of files) {
    const source = sourceAtCommit(path)
    const annotationPattern = /@KetherParser\s*\(\s*\[([\s\S]*?)\]\s*([^)]*)\)/g
    for (const match of source.matchAll(annotationPattern)) {
      const names = quotedStrings(match[1])
      invariant(names.length > 0, `Empty @KetherParser registration in ${path}`)
      const namespace = match[2].match(/namespace\s*=\s*"([^"]+)"/)?.[1] ?? "kether"
      groups.push({
        names,
        namespace,
        registration: "annotation",
        sourceFile: relativeSource(path),
      })
    }

    const directPattern = /Kether\.addAction\s*\(\s*arrayOf\s*\(([^)]*)\)\s*,/g
    for (const match of source.matchAll(directPattern)) {
      const names = quotedStrings(match[1])
      invariant(names.length > 0, `Empty direct parser registration in ${path}`)
      groups.push({
        names,
        namespace: "kether",
        registration: "direct",
        sourceFile: relativeSource(path),
      })
    }
  }
  return groups
}

function splitEnumEntries(source, enumName, endMarker) {
  const enumStart = source.indexOf(`enum class ${enumName}`)
  const bodyStart = source.indexOf("{", enumStart)
  const bodyEnd = source.indexOf(endMarker, bodyStart)
  invariant(enumStart >= 0 && bodyStart >= 0 && bodyEnd >= 0, `Cannot locate enum ${enumName}`)
  const body = source.slice(bodyStart + 1, bodyEnd)
  const entries = []
  let start = 0
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "(" || char === "{" || char === "[") depth += 1
    else if (char === ")" || char === "}" || char === "]") depth -= 1
    else if ((char === "," || char === ";") && depth === 0) {
      const entry = body.slice(start, index).trim()
      if (entry) entries.push(entry)
      start = index + 1
    }
  }
  return entries
}

function extractPlayerOperators() {
  const path = `${KOTLIN_ROOT}/taboolib/module/kether/action/game/PlayerOperators.kt`
  const source = sourceAtCommit(path)
  return splitEnumEntries(source, "PlayerOperators", "fun build()")
    .map((entry) => {
      const name = entry.match(/^([A-Z][A-Z0-9_]*)/)?.[1]
      invariant(name, `Cannot parse player operator entry: ${entry.slice(0, 80)}`)
      const readable = entry.includes("({") || /^([A-Z][A-Z0-9_]*)\s*\(\s*\{/.test(entry)
      const writable = entry.includes("{ p,") || entry.includes("{p,")
      const methods = entry.includes("*PlayerOperator.Method.values()")
        ? ["INCREASE", "DECREASE", "MODIFY"]
        : [...entry.matchAll(/PlayerOperator\.Method\.(INCREASE|DECREASE|MODIFY)/g)].map((match) => match[1])
      return {
        id: `taboolib.player.operator.${slug(name)}`,
        name,
        category: "player",
        inputTypes: ["player"],
        outputType: readable ? "any" : "unit",
        description: `PlayerOperators.${name}（TabooLib ${VERSION}）`,
        readable,
        writable,
        methods: [...new Set(methods)],
        grammar: {
          sequence: ["player", ...name.toLowerCase().split("_"), { localRawRemainder: true }],
          source: relativeSource(path),
        },
      }
    })
}

function extractBraceBody(source, braceStart) {
  invariant(source[braceStart] === "{", `Expected opening brace at ${braceStart}`)
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return source.slice(braceStart + 1, index)
    }
  }
  throw new Error(`Unclosed brace at ${braceStart}`)
}

function extractFunctionBody(source, functionName, fromIndex) {
  const functionIndex = source.indexOf(`override fun ${functionName}`, fromIndex)
  if (functionIndex < 0) return ""
  const braceStart = source.indexOf("{", functionIndex)
  return braceStart < 0 ? "" : extractBraceBody(source, braceStart)
}

function extractPropertyKeys(body, propertyId) {
  const keys = []
  for (const match of body.matchAll(/^\s*((?:"[^"]+"\s*,\s*)*"[^"]+")\s*->/gm)) keys.push(...quotedStrings(match[1]))
  for (const match of body.matchAll(/key\s*==\s*"([^"]+)"/g)) keys.push(match[1])
  if (/key\.startsWith\("@"\)/.test(body)) keys.push("@<key>")
  if (/key\.isInt\(\)/.test(body)) keys.push("<index>")
  if (propertyId === "matcher.operator" && /instance\.group\(key\)/.test(body)) keys.push("<name>")
  return [...new Set(keys)]
}

function extractProperties(files) {
  const properties = []
  for (const path of files) {
    const source = sourceAtCommit(path)
    const annotationPattern = /@KetherProperty\s*\(\s*bind\s*=\s*([A-Za-z0-9_.]+)::class[^)]*\)/g
    for (const match of source.matchAll(annotationPattern)) {
      const tail = source.slice(match.index + match[0].length)
      const declaration = tail.match(/fun\s+([A-Za-z0-9_]+)\s*\(\)\s*=\s*object\s*:\s*ScriptProperty<[^\r\n]+>\s*\(\s*"([^"]+)"\s*\)/)
      invariant(declaration, `Cannot parse @KetherProperty declaration in ${path}`)
      const declarationIndex = match.index + match[0].length + declaration.index
      const readBody = extractFunctionBody(source, "read", declarationIndex)
      const writeBody = extractFunctionBody(source, "write", declarationIndex)
      const readKeys = extractPropertyKeys(readBody, declaration[2])
      const writeKeys = new Set(extractPropertyKeys(writeBody, declaration[2]))
      properties.push({
        id: `taboolib.property.${slug(declaration[2])}`,
        name: declaration[2],
        category: path.includes("/bukkit/") ? "platform" : "data",
        description: `${match[1]} 绑定的 ScriptProperty（TabooLib ${VERSION}）`,
        usage: "&value[<key>]",
        bind: match[1],
        source: relativeSource(path),
        keys: readKeys.map((name) => ({ name, type: "any", writable: writeKeys.has(name) })),
      })
    }
  }
  return properties
}

const colors = {
  core: "oklch(0.58 0.10 35)",
  flow: "oklch(0.62 0.14 42)",
  data: "oklch(0.68 0.12 58)",
  text: "oklch(0.60 0.11 32)",
  platform: "oklch(0.54 0.08 28)",
  player: "oklch(0.66 0.15 48)",
}

const types = {
  any: { widget: "text", color: colors.core, extends: [], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  unit: { widget: "port", color: colors.core, extends: [], ketherFillable: false, inputStrategy: "literal", serialization: "token" },
  number: { widget: "number", color: colors.data, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  int: { widget: "number", color: colors.data, step: 1, extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  long: { widget: "number", color: colors.data, step: 1, extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  float: { widget: "number", color: colors.data, extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  double: { widget: "number", color: colors.data, extends: ["number"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  text: { widget: "text", color: colors.text, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "quoted" },
  string: { widget: "text", color: colors.text, extends: ["text"], ketherFillable: true, inputStrategy: "expression", serialization: "quoted" },
  boolean: { widget: "toggle", color: colors.flow, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "token" },
  keyword: { widget: "select", color: colors.core, extends: ["text"], ketherFillable: false, inputStrategy: "literal", serialization: "token" },
  list: { widget: "list", color: colors.data, extends: ["any"], elementTypes: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "json" },
  duration: { widget: "duration", color: colors.data, extends: ["long"], ketherFillable: true, inputStrategy: "expression", serialization: "duration" },
  location: { widget: "location", color: colors.player, extends: ["any"], ketherFillable: false, inputStrategy: "raw", serialization: "raw" },
  player: { widget: "port", color: colors.player, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  action: { widget: "port", color: colors.flow, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  predicate: { widget: "port", color: colors.flow, extends: ["boolean"], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  reporter: { widget: "port", color: colors.data, extends: ["any"], ketherFillable: true, inputStrategy: "expression", serialization: "raw" },
  raw: { widget: "raw", color: colors.platform, extends: ["any"], ketherFillable: false, inputStrategy: "raw", serialization: "raw" },
}

const manualOverlay = {
  if: {
    syntax: "if <condition> then <action> [else <action>]",
    shape: "container",
    flow: "branch",
    grammar: { sequence: ["if", { input: "condition", accepts: ["predicate", "boolean"] }, "then", { branch: "then" }, { optional: ["else", { branch: "else" }] }] },
    slots: [
      { name: "then", label: "条件成立", multiple: false, optional: false, accepts: ["action"] },
      { name: "else", label: "条件不成立", multiple: false, optional: true, accepts: ["action"] },
    ],
  },
  for: {
    syntax: "for <variable> in <action> then <action>",
    shape: "container",
    flow: "loop",
    grammar: { sequence: ["for", { literal: "variable" }, "in", { input: "iterable", accepts: ["action"] }, "then", { branch: "body" }] },
    slots: [{ name: "body", label: "循环体", multiple: false, optional: false, accepts: ["action"] }],
  },
  while: {
    syntax: "while <condition> then <action>",
    shape: "container",
    flow: "loop",
    grammar: { sequence: ["while", { input: "condition", accepts: ["predicate", "boolean"] }, "then", { branch: "body" }] },
    slots: [{ name: "body", label: "循环体", multiple: false, optional: false, accepts: ["action"] }],
  },
  check: {
    syntax: "check <left> <operator> <right>",
    shape: "predicate",
    output: { type: "boolean" },
    grammar: { sequence: ["check", { input: "left", accepts: ["any"] }, { localRaw: "operator" }, { input: "right", accepts: ["any"] }] },
  },
  range: {
    syntax: "range <from> to <to> [step <step>]",
    shape: "reporter",
    output: { type: "list" },
    grammar: { sequence: ["range", { input: "from", accepts: ["double"] }, "to", { input: "to", accepts: ["double"] }, { optional: ["step", { input: "step", accepts: ["double"] }] }] },
  },
  player: {
    syntax: "player <operator> [to|add|sub <value>]",
    shape: "reporter",
    output: { type: "any" },
    category: "player",
    grammar: { sequence: ["player", { operatorCatalog: "taboolib.player.operators" }, { localRawRemainder: true }] },
  },
}

function categoryFor(group) {
  const path = group.sourceFile
  if (path.includes("/game/")) return path.includes("/bukkit/") || path.includes("/compat/") ? "platform" : "player"
  if (path.includes("/loop/")) return "flow"
  if (path.includes("/transform/") || path.includes("/supplier/")) return "data"
  return "core"
}

function actionFromGroup(group, index) {
  const [name, ...aliases] = group.names
  const id = `taboolib.action.${slug(group.namespace)}.${slug(name)}`
  const overlay = manualOverlay[name]
  const rawFallback = { localRawRemainder: true, fallback: "local-block", reason: "grammar-not-declared-by-source-extractor" }
  return {
    id,
    variantId: `${id}.default`,
    name,
    aliases,
    category: overlay?.category ?? categoryFor(group),
    namespace: group.namespace,
    description: `TabooLib ${VERSION} 注册 parser：${group.names.join(", ")}`,
    syntax: overlay?.syntax ?? `${name} <local-raw...>`,
    inputs: overlay ? [] : [{ name: "本地原始参数", key: "arguments", type: "raw", accepts: ["raw"], required: false, default: null, rawEditor: "text" }],
    output: overlay?.output ?? null,
    flow: overlay?.flow ?? "normal",
    shape: overlay?.shape ?? "raw",
    slots: overlay?.slots,
    grammar: overlay?.grammar ?? rawFallback,
    source: {
      parserGroup: index + 1,
      registration: group.registration,
      registeredNames: group.names,
      file: group.sourceFile,
      baseline: `${VERSION}@${COMMIT}`,
    },
  }
}

const head = git("rev-parse", "HEAD")
invariant(head === COMMIT, `Baseline HEAD mismatch: expected ${COMMIT}, got ${head}`)
const files = kotlinFilesAtCommit()
const parserGroups = extractParserGroups(files)
const registeredNames = parserGroups.flatMap((group) => group.names)
const operators = extractPlayerOperators()
const properties = extractProperties(files)

invariant(parserGroups.length === 89, `Expected 89 parser groups, got ${parserGroups.length}`)
invariant(registeredNames.length === 126, `Expected 126 registered names, got ${registeredNames.length}`)
invariant(operators.length === 65, `Expected 65 player operators, got ${operators.length}`)
invariant(properties.length === 7, `Expected 7 properties, got ${properties.length}`)
invariant(new Set(registeredNames).size === registeredNames.length, "Duplicate registered parser names found")
invariant(!registeredNames.includes("bossbar") && !registeredNames.includes("particle"), "Fabricated parser names survived extraction")

const actions = parserGroups.map(actionFromGroup)
const source = { id: "TabooLib", version: VERSION, commit: COMMIT, repository: BASELINE_REPOSITORY, module: MODULE_ROOT }
const schema = {
  $schema: "https://zhibeigg.github.io/Orryx/kether/contracts/actions-schema-v4.schema.json",
  version: 2,
  schemaVersion: 4,
  pluginId: "TabooLib",
  pluginVersion: VERSION,
  commit: COMMIT,
  source,
  types,
  categories: Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, { color, icon: name }])),
  actions,
  selectors: [],
  triggers: [],
  properties,
  operators,
  grammar: {
    parserGroups: parserGroups.length,
    registeredNames: registeredNames.length,
    aliasCount: registeredNames.length - parserGroups.length,
    annotationGroups: parserGroups.filter((group) => group.registration === "annotation").length,
    directRegistrationGroups: parserGroups.filter((group) => group.registration === "direct").length,
    playerOperatorCatalog: "taboolib.player.operators",
    rawFallback: "local-block",
  },
}

const overlay = {
  version: 1,
  target: { pluginId: "TabooLib", pluginVersion: VERSION, commit: COMMIT },
  source,
  rules: Object.fromEntries(Object.entries(manualOverlay).map(([name, value]) => [name, value.grammar])),
  fallback: { scope: "local", representation: "raw-block", preserveSource: true, fabricateUnknownGrammar: false },
  player: {
    operatorCount: operators.length,
    operators,
    propertyCount: properties.length,
    properties,
  },
  preservation: { comments: true, rawFragments: "local", unknownVariant: "raw-block", wholeDocumentReadOnly: false },
}

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(resolve(outputDirectory, "actions-schema.json"), `${JSON.stringify(schema, null, 2)}\n`)
writeFileSync(resolve(outputDirectory, "grammar-overlay.json"), `${JSON.stringify(overlay, null, 2)}\n`)
console.log(`Generated ${actions.length} parser groups / ${registeredNames.length} names / ${operators.length} player operators / ${properties.length} properties from ${COMMIT}`)
