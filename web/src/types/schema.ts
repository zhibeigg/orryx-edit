import type { ActionsSchema, SchemaParam as ParserSchemaParam } from "@/lib/kether-ast"

export const KETHER_TYPE_NAMES = [
  "any", "unit", "number", "int", "long", "float", "double", "decimal",
  "text", "string", "boolean", "keyword", "enum", "selector", "vector3", "matrix",
  "list", "set", "map", "duration", "location", "world", "player", "entity",
  "itemstack", "material", "potion", "effect", "sound", "particle", "block", "state",
  "uuid", "action", "predicate", "reporter", "container", "port", "raw",
] as const

export type BuiltinKetherTypeName = typeof KETHER_TYPE_NAMES[number]
export type SchemaVersion = 3 | 4
export type SchemaWidget = "number" | "text" | "toggle" | "select" | "selector" | "vector3" | "location" | "matrix" | "duration" | "port" | "list" | "raw"
export type SchemaInputStrategy = "expression" | "literal" | "raw"
export type SchemaSerialization = "token" | "quoted" | "raw" | "json" | "duration"
export type BlockShape = "command" | "reporter" | "predicate" | "container" | "raw"

export interface SchemaType {
  widget: SchemaWidget
  color: string
  step?: number
  /** 该类型的值集合是否是这些父类型的子集。 */
  extends?: string[]
  /** false 时输入槽必须使用原始类型编辑器，不能接入 Kether expression。 */
  ketherFillable: boolean
  inputStrategy: SchemaInputStrategy
  serialization: SchemaSerialization
  enumValues?: string[]
  elementTypes?: string[]
  description?: string
}

export interface SchemaCategory {
  color: string
  icon: string
}

export interface KeywordGrammar {
  alternatives: string[]
  mode: "flag" | "prefix"
  optional?: boolean
}

export interface SchemaInput {
  name: string
  key: string
  type: string
  /** 槽位允许的最小类型集合；缺省时规范化为 [type]。 */
  accepts: string[]
  required: boolean
  default: unknown
  description?: string
  /** v3 兼容表示；规范化后同时提供 keywords。 */
  keyword?: string
  keywords?: KeywordGrammar
  options?: string[]
  min?: number
  max?: number
  step?: number
  rawEditor?: "text" | "json" | "yaml" | "location" | "selector"
}

export interface SchemaOutput {
  type: string
  description?: string
}

export interface SchemaSlot {
  name: string
  label: string
  multiple: boolean
  optional?: boolean
  accepts: string[]
}

export interface SchemaProvide {
  name: string
  key: string
  type: string
  description?: string
}

export type FlowType = "normal" | "branch" | "loop" | "container"

export interface SchemaAction {
  id: string
  /** 同名 parser group 下永久稳定的变体 ID。 */
  variantId: string
  name: string
  aliases: string[]
  category: string
  namespace: string
  description: string
  example?: string
  examples?: string[]
  syntax: string
  builtin?: boolean
  deprecated?: boolean | null
  suspends?: boolean
  requirements?: string[]
  inputs: SchemaInput[]
  output: SchemaOutput | null
  flow: FlowType
  shape: BlockShape
  slots?: SchemaSlot[]
  provides?: SchemaProvide[]
  source?: Record<string, unknown>
  execution?: Record<string, unknown>
  grammar?: Record<string, unknown>
}

export interface SchemaSelectorParam {
  name: string
  key: string
  type: string
  accepts: string[]
  default?: unknown
}

export interface SchemaSelector {
  id: string
  name: string
  aliases: string[]
  category?: string
  description: string
  syntax: string
  examples?: string[]
  params: SchemaSelectorParam[]
}

export interface SchemaTriggerVariable {
  name: string
  type: string
  description?: string
}

export interface SchemaTrigger {
  id: string
  name: string
  category: string
  description?: string
  variables: SchemaTriggerVariable[]
}

export interface SchemaPropertyKey {
  name: string
  type: string
  writable: boolean
  description?: string
}

export interface SchemaProperty {
  id: string
  name: string
  category: string
  description?: string
  usage?: string
  keys: SchemaPropertyKey[]
}

export interface SchemaOperator {
  id: string
  name: string
  aliases?: string[]
  category: string
  description?: string
  inputTypes: string[]
  outputType: string
  grammar?: Record<string, unknown>
}

export interface ActionsSchemaV2 {
  $schema?: string
  version: 2
  schemaVersion?: SchemaVersion
  pluginId?: string
  pluginVersion?: string
  commit?: string
  generatedAt?: string
  source?: { id: string; version?: string; commit?: string }
  types: Record<string, SchemaType>
  categories: Record<string, SchemaCategory>
  actions: SchemaAction[]
  selectors: SchemaSelector[]
  triggers: SchemaTrigger[]
  properties: SchemaProperty[]
  operators?: SchemaOperator[]
  grammar?: Record<string, unknown>
}

export type UnifiedActionsSchema = ActionsSchemaV2

export interface SchemaCatalog {
  schema: UnifiedActionsSchema
  byId: ReadonlyMap<string, SchemaAction>
  byVariantId: ReadonlyMap<string, SchemaAction>
  byName: ReadonlyMap<string, readonly SchemaAction[]>
  byAlias: ReadonlyMap<string, readonly SchemaAction[]>
  byKeyword: ReadonlyMap<string, readonly SchemaAction[]>
  selectorsByName: ReadonlyMap<string, readonly SchemaSelector[]>
}

export interface SchemaValidationResult {
  ok: boolean
  errors: string[]
  schema?: UnifiedActionsSchema
}

interface LegacySchema extends Record<string, unknown> {
  version?: number
  schemaVersion?: number
  types?: Record<string, unknown>
  categories?: Record<string, unknown>
  actions?: Array<Record<string, unknown>>
  selectors?: Array<Record<string, unknown>>
  triggers?: Array<Record<string, unknown>>
  properties?: Array<Record<string, unknown>>
  operators?: Array<Record<string, unknown>>
}

const TYPE_DEFAULTS: Record<string, Omit<SchemaType, "color">> = {
  number: { widget: "number", ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["any"] },
  int: { widget: "number", step: 1, ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["number"] },
  long: { widget: "number", step: 1, ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["number"] },
  float: { widget: "number", ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["number"] },
  double: { widget: "number", ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["number"] },
  decimal: { widget: "number", ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["number"] },
  text: { widget: "text", ketherFillable: true, inputStrategy: "expression", serialization: "quoted", extends: ["any"] },
  string: { widget: "text", ketherFillable: true, inputStrategy: "expression", serialization: "quoted", extends: ["text"] },
  boolean: { widget: "toggle", ketherFillable: true, inputStrategy: "expression", serialization: "token", extends: ["any"] },
  keyword: { widget: "select", ketherFillable: false, inputStrategy: "literal", serialization: "token", extends: ["text"] },
  enum: { widget: "select", ketherFillable: false, inputStrategy: "literal", serialization: "token", extends: ["text"] },
  selector: { widget: "selector", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["text"] },
  vector3: { widget: "vector3", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["any"] },
  matrix: { widget: "matrix", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["any"] },
  list: { widget: "list", ketherFillable: true, inputStrategy: "expression", serialization: "json", extends: ["any"] },
  set: { widget: "list", ketherFillable: true, inputStrategy: "expression", serialization: "json", extends: ["any"] },
  map: { widget: "raw", ketherFillable: true, inputStrategy: "expression", serialization: "json", extends: ["any"] },
  duration: { widget: "duration", ketherFillable: true, inputStrategy: "expression", serialization: "duration", extends: ["long"] },
  location: { widget: "location", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["any"] },
  action: { widget: "port", ketherFillable: true, inputStrategy: "expression", serialization: "raw", extends: ["any"] },
  predicate: { widget: "port", ketherFillable: true, inputStrategy: "expression", serialization: "raw", extends: ["boolean"] },
  reporter: { widget: "port", ketherFillable: true, inputStrategy: "expression", serialization: "raw", extends: ["any"] },
  container: { widget: "port", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["any"] },
  port: { widget: "port", ketherFillable: true, inputStrategy: "expression", serialization: "raw", extends: ["any"] },
  raw: { widget: "raw", ketherFillable: false, inputStrategy: "raw", serialization: "raw", extends: ["any"] },
  any: { widget: "text", ketherFillable: true, inputStrategy: "expression", serialization: "raw", extends: [] },
  unit: { widget: "port", ketherFillable: false, inputStrategy: "literal", serialization: "token", extends: [] },
}

const DEFAULT_TYPE_COLOR = "oklch(0.72 0.13 48)"
const DEFAULT_CATEGORY: SchemaCategory = { color: "oklch(0.58 0.08 35)", icon: "puzzle" }
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asAliasArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [item]
    const name = asString(asObject(item).name)
    return name ? [name] : []
  })
}

function inferTypeDefinition(name: string, raw: unknown): SchemaType {
  const source = asObject(raw)
  const normalized = name.toLowerCase()
  const defaults = TYPE_DEFAULTS[normalized] ?? {
    widget: "raw" as const,
    ketherFillable: false,
    inputStrategy: "raw" as const,
    serialization: "raw" as const,
    extends: normalized === "any" ? [] : ["any"],
  }
  const declaredParents = asStringArray(source.extends).length > 0 ? asStringArray(source.extends) : asStringArray(source.parents)
  const ketherFillable = typeof source.ketherFillable === "boolean" ? source.ketherFillable : defaults.ketherFillable
  return {
    ...defaults,
    ...source,
    widget: (source.widget as SchemaWidget | undefined) ?? defaults.widget,
    color: asString(source.color, DEFAULT_TYPE_COLOR),
    extends: declaredParents.length > 0 || normalized === "any" ? declaredParents : defaults.extends,
    ketherFillable,
    inputStrategy: (source.inputStrategy as SchemaInputStrategy | undefined) ?? (ketherFillable ? defaults.inputStrategy : normalized === "keyword" ? "literal" : "raw"),
    serialization: (source.serialization as SchemaSerialization | undefined) ?? defaults.serialization,
    enumValues: asStringArray(source.enumValues),
    elementTypes: asStringArray(source.elementTypes),
  }
}

function normalizeKeyword(input: Record<string, unknown>): KeywordGrammar | undefined {
  const explicit = asObject(input.keywords)
  const alternatives = asStringArray(explicit.alternatives)
  if (alternatives.length > 0) {
    return {
      alternatives,
      mode: explicit.mode === "flag" ? "flag" : "prefix",
      optional: typeof explicit.optional === "boolean" ? explicit.optional : undefined,
    }
  }
  const declaredAlternatives = asStringArray(input.keywordAlternatives)
  const keyword = asString(input.keyword)
  const fallbackAlternatives = keyword.split("/").map((part) => part.trim()).filter(Boolean)
  const resolvedAlternatives = declaredAlternatives.length > 0 ? declaredAlternatives : fallbackAlternatives
  if (resolvedAlternatives.length === 0) return undefined
  return {
    alternatives: resolvedAlternatives,
    mode: asString(input.type).toLowerCase() === "keyword" ? "flag" : "prefix",
    optional: input.required === false,
  }
}

function stableFallbackId(namespace: string, kind: string, name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || kind
  return `${namespace.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "schema"}.${kind}.${slug}.${index}`
}

function normalizeInput(raw: unknown, index: number): SchemaInput {
  const input = asObject(raw)
  const type = asString(input.type, "any")
  const key = asString(input.key, asString(input.name, `p${index}`))
  const keywords = normalizeKeyword(input)
  const accepts = asStringArray(input.accepts).length > 0 ? asStringArray(input.accepts) : asStringArray(input.acceptedTypes)
  return {
    ...input,
    name: asString(input.name, key),
    key,
    type,
    accepts: accepts.length > 0 ? accepts : [type],
    required: input.required !== false && input.optional !== true,
    default: Object.prototype.hasOwnProperty.call(input, "default") ? input.default : null,
    description: asString(input.description) || undefined,
    keyword: asString(input.keyword) || (keywords ? keywords.alternatives.join("/") : undefined),
    keywords,
    options: asStringArray(input.options).length > 0 ? asStringArray(input.options) : undefined,
    rawEditor: input.rawEditor as SchemaInput["rawEditor"],
  }
}

function inferShape(flow: FlowType, output: SchemaOutput | null): BlockShape {
  if (flow !== "normal") return "container"
  if (!output) return "command"
  return output.type.toLowerCase() === "boolean" || output.type.toLowerCase() === "predicate" ? "predicate" : "reporter"
}

/** 将 v1/v2 数据布局及 v3/v4 发布契约统一为 Editor Schema。 */
export function normalizeSchema(raw: unknown): UnifiedActionsSchema {
  const source = asObject(raw) as LegacySchema
  const rawTypes = asObject(source.types)
  const typeNames = new Set([...Object.keys(rawTypes), "any", "raw", "action", "predicate", "reporter"])
  const types = Object.fromEntries([...typeNames].map((name) => [name, inferTypeDefinition(name, rawTypes[name])]))
  const categories: Record<string, SchemaCategory> = Object.fromEntries(
    Object.entries(asObject(source.categories)).map(([name, value]) => {
      const category = asObject(value)
      return [name, { color: asString(category.color, DEFAULT_CATEGORY.color), icon: asString(category.icon, DEFAULT_CATEGORY.icon) }]
    })
  )
  const actions = (source.actions ?? []).map((rawAction, index): SchemaAction => {
    const action = asObject(rawAction)
    const name = asString(action.name, `action-${index}`)
    const namespace = asString(action.namespace, asString(source.pluginId, "default")).toLowerCase()
    const id = asString(action.id, stableFallbackId(namespace, "action", name, index))
    const grammar = asObject(action.grammar)
    const rawInputs = Array.isArray(action.inputs)
      ? action.inputs
      : Array.isArray(grammar.inputs)
        ? grammar.inputs
        : Array.isArray(action.params)
          ? action.params
          : []
    const inputs = rawInputs.map(normalizeInput)
    const outputObject = action.output === null || action.output === undefined ? null : asObject(action.output)
    const outputStatus = asString(outputObject?.status)
    const output = outputObject && Object.keys(outputObject).length > 0 && outputStatus !== "none"
      ? { type: asString(outputObject.type, "any"), description: asString(outputObject.description) || undefined }
      : null
    const flow = (["normal", "branch", "loop", "container"].includes(asString(action.flow)) ? action.flow : "normal") as FlowType
    const variantId = asString(action.variantId, id)
    const category = asString(action.category, "uncategorized")
    if (!categories[category]) categories[category] = { ...DEFAULT_CATEGORY }
    return {
      ...action,
      id,
      variantId,
      name,
      aliases: asAliasArray(action.aliases),
      category,
      namespace,
      description: asString(action.description),
      syntax: asString(action.syntax, asString(grammar.syntax, name)),
      inputs,
      output,
      flow,
      shape: (["command", "reporter", "predicate", "container", "raw"].includes(asString(action.shape)) ? action.shape : inferShape(flow, output)) as BlockShape,
      slots: Array.isArray(action.slots) ? action.slots.map((slotRaw) => {
        const slot = asObject(slotRaw)
        const accepts = asStringArray(slot.accepts).length > 0 ? asStringArray(slot.accepts) : asStringArray(slot.acceptedTypes)
        return {
          name: asString(slot.name),
          label: asString(slot.label, asString(slot.name)),
          multiple: slot.multiple !== false,
          optional: slot.optional === true,
          accepts: accepts.length > 0 ? accepts : ["action"],
        }
      }) : undefined,
      provides: Array.isArray(action.provides) ? action.provides as unknown as SchemaProvide[] : undefined,
    }
  })
  const selectors = (source.selectors ?? []).map((rawSelector, index): SchemaSelector => {
    const selector = asObject(rawSelector)
    const name = asString(selector.name, `selector-${index}`)
    return {
      ...selector,
      id: asString(selector.id, stableFallbackId("schema", "selector", name, index)),
      name,
      aliases: asAliasArray(selector.aliases),
      category: asString(selector.category) || undefined,
      description: asString(selector.description),
      syntax: asString(selector.syntax, `@${name}`),
      examples: asStringArray(selector.examples),
      params: (Array.isArray(selector.params) ? selector.params : []).map((paramRaw, paramIndex) => {
        const param = asObject(paramRaw)
        const type = asString(param.type, "text")
        return {
          name: asString(param.name, `p${paramIndex}`),
          key: asString(param.key, asString(param.name, `p${paramIndex}`)),
          type,
          accepts: asStringArray(param.accepts).length > 0
            ? asStringArray(param.accepts)
            : asStringArray(param.acceptedTypes).length > 0
              ? asStringArray(param.acceptedTypes)
              : [type],
          default: param.default,
        }
      }),
    }
  })
  const triggers = (source.triggers ?? []).map((rawTrigger, index): SchemaTrigger => {
    const trigger = asObject(rawTrigger)
    const name = asString(trigger.name, `trigger-${index}`)
    return {
      id: asString(trigger.id, stableFallbackId("schema", "trigger", name, index)),
      name,
      category: asString(trigger.category, "other"),
      description: asString(trigger.description) || undefined,
      variables: [
        ...(Array.isArray(trigger.variables) ? trigger.variables : []),
        ...(Array.isArray(trigger.specialKeys) ? trigger.specialKeys : []),
      ].map((rawVariable) => {
        const variable = asObject(rawVariable)
        return { name: asString(variable.name), type: asString(variable.type, "any"), description: asString(variable.description) || undefined }
      }),
    }
  })
  const properties = (source.properties ?? []).map((rawProperty, index): SchemaProperty => {
    const property = asObject(rawProperty)
    const name = asString(property.name, `property-${index}`)
    return {
      id: asString(property.id, stableFallbackId("schema", "property", name, index)),
      name,
      category: asString(property.category, asString(property.group, "other")),
      description: asString(property.description) || undefined,
      usage: asString(property.usage) || undefined,
      keys: (Array.isArray(property.keys) ? property.keys : []).map((rawKey) => {
        const key = asObject(rawKey)
        return { name: asString(key.name), type: asString(key.type, "any"), writable: key.writable === true, description: asString(key.description) || undefined }
      }),
    }
  })
  const schemaVersion = source.schemaVersion === 4 ? 4 : source.schemaVersion === 3 ? 3 : undefined
  return {
    ...source,
    version: 2,
    schemaVersion,
    pluginId: asString(source.pluginId) || undefined,
    pluginVersion: asString(source.pluginVersion) || undefined,
    commit: asString(source.commit) || undefined,
    types,
    categories,
    actions,
    selectors,
    triggers,
    properties,
    operators: Array.isArray(source.operators) ? source.operators as unknown as SchemaOperator[] : undefined,
  }
}

function addIndex<T>(map: Map<string, T[]>, key: string, value: T) {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return
  const values = map.get(normalized)
  if (values) values.push(value)
  else map.set(normalized, [value])
}

export function buildSchemaCatalog(schemaInput: UnifiedActionsSchema): SchemaCatalog {
  const schema = normalizeSchema(schemaInput)
  const byId = new Map<string, SchemaAction>()
  const byVariantId = new Map<string, SchemaAction>()
  const byName = new Map<string, SchemaAction[]>()
  const byAlias = new Map<string, SchemaAction[]>()
  const byKeyword = new Map<string, SchemaAction[]>()
  const selectorsByName = new Map<string, SchemaSelector[]>()
  for (const action of schema.actions) {
    byId.set(action.id, action)
    byVariantId.set(action.variantId, action)
    addIndex(byName, action.name, action)
    for (const alias of action.aliases) addIndex(byAlias, alias, action)
    for (const input of action.inputs) {
      for (const keyword of input.keywords?.alternatives ?? []) addIndex(byKeyword, keyword, action)
    }
  }
  for (const selector of schema.selectors) {
    addIndex(selectorsByName, selector.name, selector)
    for (const alias of selector.aliases) addIndex(selectorsByName, alias, selector)
  }
  return { schema, byId, byVariantId, byName, byAlias, byKeyword, selectorsByName }
}

export function catalogActionsForName(catalog: SchemaCatalog, name: string): readonly SchemaAction[] {
  const normalized = name.toLowerCase()
  const direct = catalog.byName.get(normalized) ?? []
  const aliases = catalog.byAlias.get(normalized) ?? []
  return direct.length === 0 ? aliases : aliases.length === 0 ? direct : [...new Map([...direct, ...aliases].map((action) => [action.id, action])).values()]
}

export function keywordAlternatives(input: SchemaInput): readonly string[] {
  return input.keywords?.alternatives ?? (input.keyword ? input.keyword.split("/") : [])
}

export function selectActionVariant(catalog: SchemaCatalog, name: string, tokens: readonly string[]): SchemaAction | null {
  const candidates = catalogActionsForName(catalog, name)
  if (candidates.length <= 1) return candidates[0] ?? null
  const normalizedTokens = new Set(tokens.map((token) => token.toLowerCase()))
  return [...candidates].sort((left, right) => {
    const score = (action: SchemaAction) => action.inputs.reduce((total, input) => total + (keywordAlternatives(input).some((keyword) => normalizedTokens.has(keyword.toLowerCase())) ? 4 : 0), 0)
      + action.inputs.filter((input) => input.required).length
    return score(right) - score(left) || left.variantId.localeCompare(right.variantId)
  })[0] ?? null
}

export function isTypeAssignable(types: Record<string, SchemaType>, source: string, target: string): boolean {
  if (source.toLowerCase() === target.toLowerCase() || target.toLowerCase() === "any") return true
  const entries = Object.entries(types)
  const canonical = (name: string) => entries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[0] ?? name
  const wanted = canonical(target)
  const queue = [canonical(source)]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const parent of types[current]?.extends ?? []) {
      const resolved = canonical(parent)
      if (resolved === wanted) return true
      queue.push(resolved)
    }
  }
  return false
}

export function canFillInput(types: Record<string, SchemaType>, outputType: string, input: Pick<SchemaInput, "accepts">): boolean {
  return input.accepts.some((accepted) => isTypeAssignable(types, outputType, accepted))
}

export function validateSchemaRuntime(raw: unknown): SchemaValidationResult {
  const errors: string[] = []
  const source = asObject(raw)
  const isRegistryV4 = source.registryVersion === 4
  if (!isRegistryV4 && source.version !== 2) errors.push("version 必须为 2，或声明 registryVersion = 4")
  if (source.registryVersion !== undefined && source.registryVersion !== 4) errors.push("registryVersion 仅支持 4")
  if (source.schemaVersion !== undefined && source.schemaVersion !== 3 && source.schemaVersion !== 4) errors.push("schemaVersion 仅支持 3 或 4")
  if (!source.types || typeof source.types !== "object") errors.push("types 必须为对象")
  if (!Array.isArray(source.actions)) errors.push("actions 必须为数组")
  const schema = normalizeSchema(raw)
  const ids = new Set<string>()
  for (const action of schema.actions) {
    if (!ID_PATTERN.test(action.id)) errors.push(`action id 非法: ${action.id}`)
    if (ids.has(action.id)) errors.push(`action id 重复: ${action.id}`)
    ids.add(action.id)
    if (!schema.categories[action.category]) errors.push(`${action.id} 引用了未知分类 ${action.category}`)
    for (const input of action.inputs) {
      if (!schema.types[input.type]) errors.push(`${action.id}.${input.key} 引用了未知类型 ${input.type}`)
      if (input.accepts.length === 0) errors.push(`${action.id}.${input.key} 必须声明最小 accepts 集合`)
      for (const accepted of input.accepts) if (!schema.types[accepted]) errors.push(`${action.id}.${input.key} accepts 未知类型 ${accepted}`)
      const type = schema.types[input.type]
      if (type && !type.ketherFillable && type.inputStrategy !== "raw" && type.inputStrategy !== "literal") errors.push(`${input.type} 的不可填充策略无效`)
    }
  }
  for (const [name, type] of Object.entries(schema.types)) {
    if (typeof type.ketherFillable !== "boolean") errors.push(`${name} 缺少 ketherFillable`)
    if (!type.inputStrategy) errors.push(`${name} 缺少 inputStrategy`)
    if (!type.serialization) errors.push(`${name} 缺少 serialization`)
    for (const parent of type.extends ?? []) if (!schema.types[parent]) errors.push(`${name} extends 未知类型 ${parent}`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors, schema }
}

export function mergeSchemas(baseInput: UnifiedActionsSchema, extensionInput: UnifiedActionsSchema): UnifiedActionsSchema {
  const base = normalizeSchema(baseInput)
  const extension = normalizeSchema(extensionInput)
  const actions = [...base.actions, ...extension.actions]
  const dedupedActions = [...new Map(actions.map((action) => [action.id, action])).values()]
  const mergeById = <T extends { id: string }>(left: T[], right: T[]) => [...new Map([...left, ...right].map((item) => [item.id, item])).values()]
  return {
    ...base,
    ...extension,
    $schema: extension.$schema ?? base.$schema,
    schemaVersion: extension.schemaVersion === 4 || base.schemaVersion === 4 ? 4 : 3,
    pluginId: "Orryx+TabooLib",
    types: { ...base.types, ...extension.types },
    categories: { ...base.categories, ...extension.categories },
    actions: dedupedActions,
    selectors: mergeById(base.selectors, extension.selectors),
    triggers: mergeById(base.triggers, extension.triggers),
    properties: mergeById(base.properties, extension.properties),
    operators: mergeById(base.operators ?? [], extension.operators ?? []),
    grammar: { ...base.grammar, ...extension.grammar },
  }
}

function toParserParam(input: SchemaInput): ParserSchemaParam {
  return {
    name: input.key,
    type: input.type,
    keyword: input.keyword,
    keywords: input.keywords,
    optional: !input.required,
    default: input.default,
    options: input.options,
    accepts: input.accepts,
  }
}

export function toParserActionsSchema(schemaInput: UnifiedActionsSchema): ActionsSchema {
  const catalog = buildSchemaCatalog(schemaInput)
  return {
    actions: catalog.schema.actions.map((action) => ({
      id: action.id,
      variantId: action.variantId,
      name: action.name,
      aliases: action.aliases,
      category: action.category,
      namespace: action.namespace,
      grammar: action.grammar,
      shape: action.shape,
      flow: action.flow,
      slots: action.slots,
      params: action.inputs.map(toParserParam),
    })),
    selectors: catalog.schema.selectors.map((selector) => ({
      id: selector.id,
      name: selector.name,
      aliases: selector.aliases,
      params: selector.params.map((param) => ({ name: param.key, type: param.type, default: param.default })),
    })),
    triggers: catalog.schema.triggers,
    properties: catalog.schema.properties,
  }
}
