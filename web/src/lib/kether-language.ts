import type { languages } from "monaco-editor"

export const KETHER_LANGUAGE_ID = "kether"

export const ketherLanguageDef: languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: false,

  keywords: [
    "if", "then", "else", "not", "any", "all", "for", "in", "range", "to", "while",
    "check", "set", "get", "return", "break", "continue", "case", "when", "goto",
  ],

  actions: [
    "damage", "launch", "flash", "sleep", "sync", "async",
    "dragon", "entity", "potion", "flag", "cooldown", "mana", "spirit",
    "buff", "running", "ghost", "superBody", "superFoot",
    "callDamage", "damageProcessor", "randomAction",
    "parm", "container", "removeIf", "merge",
    "math", "calc", "inline", "lazy", "scaled",
    "player", "vector", "state",
  ],

  dragonSubs: [
    "ani", "papi", "func", "sound", "effect", "modelEffect",
  ],

  selectors: [
    "@self", "@range", "@obb", "@sector", "@floor", "@offset",
    "@current", "@origin", "@joiner", "@their", "@target",
    "@type", "@team", "@pvp",
  ],

  operators: [
    ">=", "<=", "==", "!=", ">", "<", "->",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  tokenizer: {
    root: [
      // 选择器 @xxx
      [/@[a-zA-Z_]\w*/, "selector"],

      // 变量引用 &xxx 或 &xxx[yyy]
      [/&[a-zA-Z_]\w*(\[[^\]]*\])?/, "variable.ref"],

      // 模板语法 {{ }}
      [/\{\{/, { token: "template.bracket", next: "@template" }],

      // 字符串
      [/"([^"\\]|\\.)*"/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],

      // 注释
      [/#.*$/, "comment"],

      // 数字
      [/\b\d+(\.\d+)?\b/, "number"],

      // 标识符
      [/[a-zA-Z_\u4e00-\u9fff]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@actions": "action",
          "@dragonSubs": "dragon.sub",
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

      // 空白
      [/\s+/, "white"],
    ],

    template: [
      [/\}\}/, { token: "template.bracket", next: "@pop" }],
      [/[^}]+/, "template.content"],
    ],
  },
}

export const ketherThemeRules: { token: string; foreground: string; fontStyle?: string }[] = [
  { token: "keyword", foreground: "C586C0" },
  { token: "action", foreground: "4EC9B0", fontStyle: "bold" },
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
]

// 补全项的部分类型（range 在 provideCompletionItems 中动态注入）
interface PartialCompletionItem {
  label: string
  kind: number
  insertText: string
  detail: string
  insertTextRules?: number
}

export const ketherCompletionItems: PartialCompletionItem[] = [
  // 动作补全
  ...["damage", "launch", "flash", "sleep", "sync", "async", "dragon", "entity", "potion",
    "flag", "cooldown", "mana", "spirit", "buff", "running", "ghost", "superBody", "superFoot",
    "callDamage", "damageProcessor", "randomAction", "container", "removeIf", "merge",
    "math", "calc", "inline", "lazy", "scaled", "player", "vector", "state",
  ].map((label) => ({
    label,
    kind: 1, // Function
    insertText: label,
    detail: "Kether 动作",
  })),

  // 选择器补全
  ...["@self", "@range ", "@obb ", "@sector ", "@floor ", "@offset ",
    "@current", "@origin", "@joiner", "@their", "@target",
    "@type ", "@team", "@pvp",
  ].map((label) => ({
    label: label.trim(),
    kind: 9, // Value
    insertText: label,
    detail: "选择器",
  })),

  // 常用代码片段
  ...[
    { label: "if-then-else", insertText: "if ${1:condition} then {\n  ${2}\n} else {\n  ${3}\n}", detail: "条件分支" },
    { label: "for-range", insertText: "for ${1:i} in range ${2:1} to ${3:5} then {\n  ${4}\n}", detail: "循环" },
    { label: "damage-range", insertText: "damage lazy *${1:damage} false they \"@range ${2:4} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${3:MAGIC}", detail: "范围伤害" },
    { label: "damage-obb", insertText: "damage lazy *${1:damage} false they \"@obb ${2:5} ${3:3} ${4:3} ${5:0} ${6:0} true !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${7:MAGIC}", detail: "OBB 碰撞箱伤害" },
    { label: "damage-sector", insertText: "damage lazy *${1:damage} false they \"@sector ${2:4} ${3:120} ${4:2} !@self !@type ARMOR_STAND !@team\" source \"@self\" type ${5:PHYSICS}", detail: "扇形伤害" },
    { label: "dragon-ani", insertText: "dragon ani to player ${1:动画名} ${2:1.0} they \"@self\"", detail: "播放龙核动画" },
    { label: "dragon-sound", insertText: "dragon sound send ${1:名称} ${2:路径.ogg} PLAYERS they \"@range ${3:15} @self\"", detail: "播放音效" },
    { label: "dragon-effect", insertText: "dragon effect send ${1:名称} \"${2:路径.particle}\" timeout ${3:20} they \"@self\"", detail: "播放粒子特效" },
    { label: "sleep-ticks", insertText: "sleep ${1:20}", detail: "等待 tick" },
    { label: "flag-set", insertText: "flag ${1:名称} to true timeout ${2:40}", detail: "设置标记" },
    { label: "flag-check", insertText: "if flag ${1:名称} then {\n  ${2}\n}", detail: "检查标记" },
    { label: "cooldown-set", insertText: "cooldown set ${1:0}", detail: "设置冷却" },
    { label: "buff-send", insertText: "buff send ${1:名称} ${2:200}", detail: "发送 Buff" },
    { label: "launch-forward", insertText: "launch ${1:1} ${2:0.1} ${3:0} ${4:true}", detail: "发射/位移" },
    { label: "entity-ady", insertText: "entity ady ${1:模型名} ARMOR_STAND gravity false timeout ${2:20} viewer \"@range 50\" they \"@self\"", detail: "生成实体动画" },
    { label: "case-state", insertText: "case state ${1:move} [\n  when ${2:FRONT} -> {\n    ${3}\n  }\n]", detail: "状态分支" },
  ].map((item) => ({
    ...item,
    kind: 27, // Snippet
    insertTextRules: 4, // InsertAsSnippet
  })),
]

export function registerKetherLanguage(monaco: typeof import("monaco-editor")) {
  // 注册语言
  monaco.languages.register({ id: KETHER_LANGUAGE_ID })

  // 设置 Monarch tokenizer
  monaco.languages.setMonarchTokensProvider(KETHER_LANGUAGE_ID, ketherLanguageDef)

  // 定义主题
  monaco.editor.defineTheme("kether-dark", {
    base: "vs-dark",
    inherit: true,
    rules: ketherThemeRules,
    colors: {
      "editor.background": "#0a0e14",
    },
  })

  // 注册补全提供器
  monaco.languages.registerCompletionItemProvider(KETHER_LANGUAGE_ID, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // 检查是否在 @ 后面
      const lineContent = model.getLineContent(position.lineNumber)
      const charBefore = lineContent[position.column - 2]

      let items = ketherCompletionItems.map((item) => ({
        ...item,
        range,
      } as languages.CompletionItem))

      if (charBefore === "@") {
        items = items.filter((item) => (item.label as string).startsWith("@"))
      }

      return { suggestions: items }
    },
    triggerCharacters: ["@", " "],
  })
}
