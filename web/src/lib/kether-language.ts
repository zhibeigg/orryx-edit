import type { languages } from "monaco-editor"

export const KETHER_LANGUAGE_ID = "kether"

// ---- Schema 类型 ----
interface ActionParam {
  name: string
  type: string
  required: boolean
  default?: string
  description?: string
  options?: string[]
}

interface ActionDef {
  name: string
  aliases?: string[]
  category: string
  description: string
  returnType?: string
  params?: ActionParam[]
  syntax: string
  examples?: string[]
  deprecated?: boolean
}

interface ActionsSchema {
  version: string
  pluginVersion: string
  actions: ActionDef[]
}

// ---- 全局 schema 缓存 ----
let cachedSchema: ActionsSchema | null = null
let allActionKeywords: string[] = []

export async function loadActionsSchema(baseUrl?: string): Promise<ActionsSchema> {
  const url = baseUrl || `${window.location.origin}/api/actions-schema`
  try {
    const res = await fetch(url)
    if (res.ok) {
      cachedSchema = await res.json()
      rebuildFromSchema()
    }
  } catch (e) {
    console.warn("加载 actions-schema 失败:", e)
  }
  return cachedSchema || { version: "1.0", pluginVersion: "unknown", actions: [] }
}

function rebuildFromSchema() {
  if (!cachedSchema) return
  allActionKeywords = cachedSchema.actions.flatMap(a => {
    const first = a.syntax.split(/\s+/)[0].replace(/[<>\[\]]/g, "")
    const names = [first]
    if (first.includes("/")) names.push(...first.split("/"))
    return names
  })
  allActionKeywords = [...new Set(allActionKeywords.filter(k => k.length > 0))]
}

// ---- 静态关键字（Kether 语言本身的） ----
const BUILTIN_KEYWORDS = [
  "if", "then", "else", "not", "any", "all", "for", "in", "range", "to", "while",
  "check", "set", "get", "return", "break", "continue", "case", "when", "goto",
]

const SELECTORS = [
  "@self", "@range", "@obb", "@sector", "@floor", "@offset",
  "@current", "@origin", "@joiner", "@their", "@target",
  "@type", "@team", "@pvp",
]

export const ketherThemeRules: { token: string; foreground: string; fontStyle?: string }[] = [
  { token: "keyword", foreground: "C586C0" },
  { token: "action", foreground: "4EC9B0", fontStyle: "bold" },
  { token: "action.deprecated", foreground: "6A6A6A", fontStyle: "italic strikethrough" },
  { token: "dragon.sub", foreground: "4FC1FF" },
  { token: "selector", foreground: "DCDCAA" },
  { token: "variable.ref", foreground: "9CDCFE" },
  { token: "template.bracket", foreground: "FFD700" },
  { token: "template.content", foreground: "CE9178" },
  { token: "string", foreground: "CE9178" },
  { token: "number", foreground: "B5CEA8" },
  { token: "comment", foreground: "6A9955" },
  { token: "operator", foreground: "D4D4D4" },
  { token: "bracket", foreground: "FFD700" },
  { token: "identifier", foreground: "D4D4D4" },
  { token: "param.enum", foreground: "4FC1FF" },
]

export function registerKetherLanguage(monaco: typeof import("monaco-editor")) {
  monaco.languages.register({ id: KETHER_LANGUAGE_ID })

  // Monarch tokenizer — 动态 actions 列表
  const languageDef: languages.IMonarchLanguage = {
    defaultToken: "",
    ignoreCase: false,
    keywords: BUILTIN_KEYWORDS,
    actions: allActionKeywords,
    selectors: SELECTORS,
    operators: [">=", "<=", "==", "!=", ">", "<", "->"],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    tokenizer: {
      root: [
        [/@[a-zA-Z_]\w*/, "selector"],
        [/&[a-zA-Z_]\w*(\[[^\]]*\])?/, "variable.ref"],
        [/\{\{/, { token: "template.bracket", next: "@template" }],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/#.*$/, "comment"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/[a-zA-Z_\u4e00-\u9fff]\w*/, {
          cases: {
            "@keywords": "keyword",
            "@actions": "action",
            "@default": "identifier",
          },
        }],
        [/[{}()\[\]]/, "bracket"],
        [/@symbols/, {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        }],
        [/\s+/, "white"],
      ],
      template: [
        [/\}\}/, { token: "template.bracket", next: "@pop" }],
        [/[^}]+/, "template.content"],
      ],
    },
  }

  monaco.languages.setMonarchTokensProvider(KETHER_LANGUAGE_ID, languageDef)

  monaco.editor.defineTheme("kether-dark", {
    base: "vs-dark",
    inherit: true,
    rules: ketherThemeRules,
    colors: { "editor.background": "#0a0e14" },
  })

  // ---- 补全 ----
  monaco.languages.registerCompletionItemProvider(KETHER_LANGUAGE_ID, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const lineContent = model.getLineContent(position.lineNumber)
      const charBefore = lineContent[position.column - 2]
      const textBefore = lineContent.substring(0, position.column - 1).trim()

      const items: languages.CompletionItem[] = []

      // Schema 驱动的 action 补全
      if (cachedSchema) {
        for (const action of cachedSchema.actions) {
          const syntaxFirst = action.syntax.split(/\s+/)[0]
          items.push({
            label: syntaxFirst,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: syntaxFirst,
            detail: `[${action.category}] ${action.description}`,
            documentation: buildDoc(action),
            range,
            tags: action.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : [],
          } as languages.CompletionItem)

          // 别名
          for (const alias of action.aliases || []) {
            items.push({
              label: alias,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: alias,
              detail: `→ ${syntaxFirst}`,
              documentation: buildDoc(action),
              range,
            } as languages.CompletionItem)
          }
        }

        // 上下文感知：如果前面是某个 action，补全它的 enum 参数
        const contextAction = findContextAction(textBefore)
        if (contextAction) {
          for (const param of contextAction.params || []) {
            if (param.type === "enum" && param.options) {
              for (const opt of param.options) {
                items.push({
                  label: opt,
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  insertText: opt,
                  detail: `${param.name}: ${param.description || ""}`,
                  range,
                } as languages.CompletionItem)
              }
            }
          }
        }
      }

      // 选择器补全
      if (charBefore === "@") {
        for (const sel of SELECTORS) {
          items.push({
            label: sel,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: sel.substring(1) + " ",
            detail: "选择器",
            range,
          } as languages.CompletionItem)
        }
      }

      // 关键字补全
      for (const kw of BUILTIN_KEYWORDS) {
        items.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          detail: "关键字",
          range,
        } as languages.CompletionItem)
      }

      // 代码片段
      for (const snippet of SNIPPETS) {
        items.push({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snippet.detail,
          range,
        } as languages.CompletionItem)
      }

      return { suggestions: items }
    },
    triggerCharacters: ["@", " "],
  })

  // ---- 悬浮文档 ----
  monaco.languages.registerHoverProvider(KETHER_LANGUAGE_ID, {
    provideHover: (model, position) => {
      if (!cachedSchema) return null
      const word = model.getWordAtPosition(position)
      if (!word) return null

      const action = cachedSchema.actions.find(a => {
        const first = a.syntax.split(/\s+/)[0]
        if (first === word.word) return true
        if (first.includes("/") && first.split("/").includes(word.word)) return true
        return a.aliases?.includes(word.word)
      })

      if (!action) return null

      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [
          { value: `**${action.name}**` },
          { value: `\`${action.syntax}\`` },
          { value: action.description },
          ...(action.params?.length ? [{
            value: "参数:\n" + action.params.map(p =>
              `- \`${p.name}\` (${p.type}${p.required ? "" : "?"})${p.description ? ": " + p.description : ""}${p.default ? " = " + p.default : ""}`
            ).join("\n")
          }] : []),
          ...(action.examples?.length ? [{
            value: "示例:\n```kether\n" + action.examples.join("\n") + "\n```"
          }] : []),
        ],
      }
    },
  })
}

// ---- 辅助函数 ----

function buildDoc(action: ActionDef): string {
  let doc = `**${action.name}**\n\n\`${action.syntax}\`\n\n${action.description}`
  if (action.params?.length) {
    doc += "\n\n参数:\n" + action.params.map(p =>
      `- \`${p.name}\` (${p.type}${p.required ? "" : "?"})${p.default ? " = " + p.default : ""}`
    ).join("\n")
  }
  if (action.examples?.length) {
    doc += "\n\n示例:\n```\n" + action.examples.join("\n") + "\n```"
  }
  return doc
}

function findContextAction(textBefore: string): ActionDef | null {
  if (!cachedSchema) return null
  const words = textBefore.split(/\s+/)
  for (const action of cachedSchema.actions) {
    const first = action.syntax.split(/\s+/)[0]
    const candidates = [first, ...(first.includes("/") ? first.split("/") : []), ...(action.aliases || [])]
    if (words.some(w => candidates.includes(w))) return action
  }
  return null
}

const SNIPPETS = [
  { label: "if-then-else", insertText: "if ${1:condition} then {\n  ${2}\n} else {\n  ${3}\n}", detail: "条件分支" },
  { label: "for-range", insertText: "for ${1:i} in range ${2:1} to ${3:5} then {\n  ${4}\n}", detail: "循环" },
  { label: "damage-range", insertText: "damage lazy *${1:damage} false they \"@range ${2:4} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${3:MAGIC}", detail: "范围伤害" },
  { label: "damage-obb", insertText: "damage lazy *${1:damage} false they \"@obb ${2:5} ${3:3} ${4:3} ${5:0} ${6:0} true !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${7:MAGIC}", detail: "OBB 碰撞箱伤害" },
  { label: "damage-sector", insertText: "damage lazy *${1:damage} false they \"@sector ${2:4} ${3:120} ${4:2} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${5:PHYSICS}", detail: "扇形伤害" },
  { label: "sleep-ticks", insertText: "sleep ${1:20}", detail: "等待 tick" },
  { label: "flag-set", insertText: "flag ${1:名称} to true timeout ${2:40}", detail: "设置标记" },
]
