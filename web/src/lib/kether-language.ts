import type { languages, editor } from "monaco-editor"

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
let deprecatedKeywords: Set<string> = new Set()

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
  const keywords: string[] = []
  deprecatedKeywords = new Set()

  for (const a of cachedSchema.actions) {
    const first = a.syntax.split(/\s+/)[0].replace(/[<>\[\]]/g, "")
    const names = [first]
    if (first.includes("/")) names.push(...first.split("/"))
    for (const n of names) {
      if (n.length > 0) {
        keywords.push(n)
        if (a.deprecated) deprecatedKeywords.add(n)
      }
    }
  }
  allActionKeywords = [...new Set(keywords)]
}

// ---- 静态关键字 ----
const BUILTIN_KEYWORDS = [
  "if", "then", "else", "not", "any", "all", "for", "in", "range", "to", "while",
  "check", "set", "get", "return", "break", "continue", "case", "when", "goto",
  "true", "false", "null", "they", "source", "type", "key", "timeout",
  "lazy", "inline", "scaled", "sync", "async",
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
  { token: "selector", foreground: "DCDCAA" },
  { token: "variable.ref", foreground: "9CDCFE" },
  { token: "variable.lazy", foreground: "9CDCFE", fontStyle: "italic" },
  { token: "template.bracket", foreground: "FFD700" },
  { token: "template.content", foreground: "CE9178" },
  { token: "string", foreground: "CE9178" },
  { token: "number", foreground: "B5CEA8" },
  { token: "comment", foreground: "6A9955", fontStyle: "italic" },
  { token: "operator", foreground: "D4D4D4" },
  { token: "bracket", foreground: "FFD700" },
  { token: "identifier", foreground: "D4D4D4" },
]

export function registerKetherLanguage(monaco: typeof import("monaco-editor")) {
  monaco.languages.register({ id: KETHER_LANGUAGE_ID })

  // ---- 语言配置（括号匹配、自动闭合） ----
  monaco.languages.setLanguageConfiguration(KETHER_LANGUAGE_ID, {
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "{{", close: "}}" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    comments: { lineComment: "#" },
    wordPattern: /(-?\d*\.\d\w*)|([^\s`~!@#%^&*()\-=+\[{\]}\\|;:'",.<>/?\s]+)/g,
  })

  // ---- Monarch tokenizer ----
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
        // 注释
        [/#.*$/, "comment"],
        // 选择器
        [/@[a-zA-Z_]\w*/, "selector"],
        // 懒变量引用 *xxx
        [/\*[a-zA-Z_\u4e00-\u9fff]\w*/, "variable.lazy"],
        // 变量引用 &xxx 或 &xxx[yyy]
        [/&[a-zA-Z_]\w*(\[[^\]]*\])?/, "variable.ref"],
        // 模板
        [/\{\{/, { token: "template.bracket", next: "@template" }],
        // 字符串
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        // 数字
        [/\b\d+(\.\d+)?\b/, "number"],
        // 标识符（含中文）
        [/[a-zA-Z_\u4e00-\u9fff][\w\u4e00-\u9fff]*/, {
          cases: {
            "@keywords": "keyword",
            "@actions": "action",
            "@default": "identifier",
          },
        }],
        // 括号
        [/[{}()\[\]]/, "bracket"],
        // 运算符
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
      const lineContent = model.getLineContent(position.lineNumber)
      const textBeforeCursor = lineContent.substring(0, position.column - 1)

      // 注释内不提供补全
      const commentIdx = findCommentStart(lineContent)
      if (commentIdx >= 0 && position.column - 1 > commentIdx) {
        return { suggestions: [] }
      }

      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const charBefore = textBeforeCursor[textBeforeCursor.length - 1]
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
            documentation: { value: buildDoc(action) },
            range,
            tags: action.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : [],
            sortText: action.deprecated ? "z" + syntaxFirst : "a" + syntaxFirst,
          } as languages.CompletionItem)

          for (const alias of action.aliases || []) {
            items.push({
              label: alias,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: alias,
              detail: `→ ${syntaxFirst}`,
              documentation: { value: buildDoc(action) },
              range,
              sortText: "b" + alias,
            } as languages.CompletionItem)
          }
        }

        // 上下文 enum 参数补全
        const contextAction = findContextAction(textBeforeCursor)
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
                  sortText: "0" + opt,
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
            sortText: "0" + sel,
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
          sortText: "c" + kw,
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
          sortText: "d" + snippet.label,
        } as languages.CompletionItem)
      }

      return { suggestions: items }
    },
    // 中文字符也触发补全
    triggerCharacters: ["@", " ", "*", "&"],
  })

  // ---- 悬浮文档 ----
  monaco.languages.registerHoverProvider(KETHER_LANGUAGE_ID, {
    provideHover: (model, position) => {
      if (!cachedSchema) return null
      const word = model.getWordAtPosition(position)
      if (!word) return null

      // 注释内不显示悬浮
      const lineContent = model.getLineContent(position.lineNumber)
      const commentIdx = findCommentStart(lineContent)
      if (commentIdx >= 0 && word.startColumn - 1 >= commentIdx) return null

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

  // ---- 语法诊断（警告） ----
  registerDiagnostics(monaco)
}

// ---- 语法诊断 ----
let diagnosticTimer: ReturnType<typeof setTimeout> | null = null

function registerDiagnostics(monaco: typeof import("monaco-editor")) {
  const validate = (model: editor.ITextModel) => {
    if (model.getLanguageId() !== KETHER_LANGUAGE_ID) return
    const markers: editor.IMarkerData[] = []
    const lineCount = model.getLineCount()

    let braceDepth = 0
    let bracketDepth = 0

    for (let i = 1; i <= lineCount; i++) {
      const line = model.getLineContent(i)
      const commentIdx = findCommentStart(line)
      const code = commentIdx >= 0 ? line.substring(0, commentIdx) : line

      // 括号计数
      for (let j = 0; j < code.length; j++) {
        const ch = code[j]
        if (ch === "{") braceDepth++
        else if (ch === "}") braceDepth--
        else if (ch === "[") bracketDepth++
        else if (ch === "]") bracketDepth--

        if (braceDepth < 0) {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: "多余的 }",
            startLineNumber: i, startColumn: j + 1,
            endLineNumber: i, endColumn: j + 2,
          })
          braceDepth = 0
        }
        if (bracketDepth < 0) {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: "多余的 ]",
            startLineNumber: i, startColumn: j + 1,
            endLineNumber: i, endColumn: j + 2,
          })
          bracketDepth = 0
        }
      }

      // 未闭合字符串检测
      const strMatches = code.match(/(?<!\\)"([^"\\]|\\.)*$/g)
      if (strMatches) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: "未闭合的字符串",
          startLineNumber: i, startColumn: 1,
          endLineNumber: i, endColumn: line.length + 1,
        })
      }

      // 废弃 action 警告
      if (deprecatedKeywords.size > 0) {
        const wordRegex = /[a-zA-Z_\u4e00-\u9fff][\w\u4e00-\u9fff]*/g
        let m
        while ((m = wordRegex.exec(code)) !== null) {
          if (deprecatedKeywords.has(m[0])) {
            markers.push({
              severity: monaco.MarkerSeverity.Hint,
              message: `"${m[0]}" 已废弃`,
              startLineNumber: i, startColumn: m.index + 1,
              endLineNumber: i, endColumn: m.index + m[0].length + 1,
              tags: [1], // Unnecessary
            })
          }
        }
      }
    }

    // 全局括号未闭合
    if (braceDepth > 0) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `有 ${braceDepth} 个未闭合的 {`,
        startLineNumber: lineCount, startColumn: 1,
        endLineNumber: lineCount, endColumn: model.getLineContent(lineCount).length + 1,
      })
    }
    if (bracketDepth > 0) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `有 ${bracketDepth} 个未闭合的 [`,
        startLineNumber: lineCount, startColumn: 1,
        endLineNumber: lineCount, endColumn: model.getLineContent(lineCount).length + 1,
      })
    }

    monaco.editor.setModelMarkers(model, "kether", markers)
  }

  // 监听所有编辑器模型变化
  monaco.editor.onDidCreateModel((model) => {
    if (model.getLanguageId() !== KETHER_LANGUAGE_ID) return
    validate(model)
    model.onDidChangeContent(() => {
      if (diagnosticTimer) clearTimeout(diagnosticTimer)
      diagnosticTimer = setTimeout(() => validate(model), 300)
    })
  })
}

// ---- 辅助函数 ----

/** 找到行中注释开始位置（排除字符串内的 #） */
function findCommentStart(line: string): number {
  let inString = false
  let stringChar = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inString) {
      if (ch === stringChar && line[i - 1] !== "\\") inString = false
    } else {
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch }
      else if (ch === "#") return i
    }
  }
  return -1
}

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
  // 从右向左找最近的 action
  const words = textBefore.split(/\s+/).reverse()
  for (const w of words) {
    for (const action of cachedSchema.actions) {
      const first = action.syntax.split(/\s+/)[0]
      const candidates = [first, ...(first.includes("/") ? first.split("/") : []), ...(action.aliases || [])]
      if (candidates.includes(w)) return action
    }
  }
  return null
}

const SNIPPETS = [
  { label: "if-then-else", insertText: "if ${1:condition} then {\n  ${2}\n} else {\n  ${3}\n}", detail: "条件分支" },
  { label: "for-range", insertText: "for ${1:i} in range ${2:1} to ${3:5} then {\n  ${4}\n}", detail: "循环" },
  { label: "while-loop", insertText: "while { ${1:condition} } then {\n  ${2}\n}", detail: "循环" },
  { label: "sync-block", insertText: "sync {\n  ${1}\n}", detail: "主线程同步块" },
  { label: "async-block", insertText: "async {\n  ${1}\n}", detail: "异步块" },
  { label: "case-when", insertText: "case ${1:expression} [\n  when ${2:value} -> {\n    ${3}\n  }\n]", detail: "分支匹配" },
  { label: "damage-range", insertText: "damage lazy *${1:damage} false they \"@range ${2:4} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${3:MAGIC}", detail: "范围伤害" },
  { label: "damage-obb", insertText: "damage lazy *${1:damage} false they \"@obb ${2:5} ${3:3} ${4:3} ${5:0} ${6:0} true !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${7:MAGIC}", detail: "OBB 碰撞箱伤害" },
  { label: "damage-sector", insertText: "damage lazy *${1:damage} false they \"@sector ${2:4} ${3:120} ${4:2} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${5:PHYSICS}", detail: "扇形伤害" },
  { label: "sleep-ticks", insertText: "sleep ${1:20}", detail: "等待 tick" },
  { label: "flag-set", insertText: "flag ${1:名称} to true timeout ${2:40}", detail: "设置标记" },
  { label: "flag-check", insertText: "if flag ${1:名称} then {\n  ${2}\n}", detail: "检查标记" },
  { label: "flag-remove", insertText: "flag ${1:名称} remove", detail: "移除标记" },
  { label: "cooldown-set", insertText: "cooldown set ${1:0}", detail: "设置冷却" },
  { label: "buff-send", insertText: "buff send ${1:名称} ${2:200}", detail: "发送 Buff" },
  { label: "dragon-ani", insertText: "dragon ani to player ${1:动画名} ${2:1.0} they \"@self\"", detail: "播放龙核动画" },
  { label: "dragon-sound", insertText: "dragon sound send ${1:名称} ${2:路径.ogg} PLAYERS they \"@range ${3:15}\"", detail: "播放音效" },
  { label: "dragon-effect", insertText: "dragon effect send ${1:名称} \"${2:路径.particle}\" timeout ${3:20} they \"@self\"", detail: "播放粒子特效" },
  { label: "dragon-modelEffect", insertText: "dragon modelEffect create ${1:名称} ${2:模型} ${3:40} they \"@self\"", detail: "创建模型特效" },
  { label: "launch-forward", insertText: "launch ${1:1} ${2:0.1} ${3:0} ${4:true}", detail: "发射/位移" },
  { label: "entity-ady", insertText: "entity ady ${1:模型名} ARMOR_STAND gravity false timeout ${2:20} viewer \"@range 50\" they \"@self\"", detail: "生成实体动画" },
  { label: "potion-set", insertText: "potion set ${1:SLOW} ${2:20} level ${3:1}", detail: "施加药水效果" },
  { label: "set-variable", insertText: "set ${1:a} to ${2:expression}", detail: "设置变量" },
  { label: "tell-message", insertText: "tell colored \"${1:&c消息}\"", detail: "发送消息" },
]
