/**
 * 简易 Kether 求值器
 * 支持在前端预览经验曲线等简单脚本的计算结果
 *
 * 支持的语法:
 * - 纯数字: 100
 * - calc "数学表达式": calc "200*level"
 * - set 变量 to 表达式: set a to pow 1.2 &level
 * - pow base exp: pow 1.2 10
 * - math add/sub/mul/div [...]: math add [ 100 200 ]
 * - case &变量 [ when 条件 -> 表达式 ]: 分支匹配
 * - &变量名: 变量引用
 * - 多行脚本: 逐行执行，最后一个表达式的值作为返回值
 */

type Env = Map<string, number>

export function evaluateKether(script: string, vars: Record<string, number> = {}): number {
  const env: Env = new Map(Object.entries(vars))
  const lines = splitStatements(script)
  let result = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    try {
      result = evalStatement(trimmed, env)
    } catch {
      // 无法求值的行跳过
    }
  }

  return result
}

/** 将脚本拆分为语句（处理多行 case 块和单行折叠格式） */
function splitStatements(script: string): string[] {
  // 预处理：如果是单行（YAML 折叠格式），在关键字前插入换行
  let normalized = script
  if (!script.includes("\n")) {
    // 在 case 前断行（但不在字符串内）
    normalized = splitBeforeKeywords(script)
  }

  const lines = normalized.split("\n")
  const statements: string[] = []
  let buffer = ""
  let bracketDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    buffer += (buffer ? "\n" : "") + trimmed

    for (const ch of trimmed) {
      if (ch === "[") bracketDepth++
      else if (ch === "]") bracketDepth--
    }

    if (bracketDepth <= 0) {
      statements.push(buffer)
      buffer = ""
      bracketDepth = 0
    }
  }

  if (buffer) statements.push(buffer)
  return statements
}

/** 求值单条语句 */
function evalStatement(stmt: string, env: Env): number {
  // set 变量 to 表达式
  const setMatch = stmt.match(/^set\s+(\w+)\s+to\s+(.+)$/s)
  if (setMatch) {
    const val = evalExpr(setMatch[2].trim(), env)
    env.set(setMatch[1], val)
    return val
  }

  // case 表达式 [ when ... ]
  if (stmt.startsWith("case ")) {
    return evalCase(stmt, env)
  }

  return evalExpr(stmt, env)
}

/** 求值表达式 */
function evalExpr(expr: string, env: Env): number {
  const trimmed = expr.trim()

  // 纯数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed)

  // 变量引用 &xxx
  if (trimmed.startsWith("&")) {
    const name = trimmed.substring(1)
    return env.get(name) ?? 0
  }

  // 变量引用（无 & 前缀，在 calc 内部替换后的）
  if (env.has(trimmed)) return env.get(trimmed)!

  // calc "表达式"
  const calcMatch = trimmed.match(/^calc\s+"([^"]+)"$/)
  if (calcMatch) {
    return evalCalc(calcMatch[1], env)
  }

  // pow base exp
  const powMatch = trimmed.match(/^pow\s+(.+?)\s+(.+)$/)
  if (powMatch) {
    const base = evalExpr(powMatch[1], env)
    const exp = evalExpr(powMatch[2], env)
    return Math.pow(base, exp)
  }

  // math add/sub/mul/div [ ... ]
  const mathMatch = trimmed.match(/^math\s+(add|sub|mul|div)\s+\[\s*(.+?)\s*\]$/s)
  if (mathMatch) {
    const op = mathMatch[1]
    const args = splitArgs(mathMatch[2]).map(a => evalExpr(a, env))
    if (args.length === 0) return 0
    return args.reduce((acc, v) => {
      switch (op) {
        case "add": return acc + v
        case "sub": return acc - v
        case "mul": return acc * v
        case "div": return v !== 0 ? acc / v : 0
        default: return acc
      }
    })
  }

  // 尝试作为 calc 表达式直接求值（无 calc 关键字）
  try {
    return evalCalc(trimmed, env)
  } catch {
    return 0
  }
}

/** 求值 calc 内的数学表达式 */
function evalCalc(expr: string, env: Env): number {
  // 替换变量
  let replaced = expr
  // 替换 &变量名
  replaced = replaced.replace(/&(\w+)/g, (_, name) => String(env.get(name) ?? 0))
  // 替换裸变量名（从长到短排序避免部分匹配）
  const varNames = [...env.keys()].sort((a, b) => b.length - a.length)
  for (const name of varNames) {
    replaced = replaced.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, "g"), String(env.get(name) ?? 0))
  }

  // 安全检查：只允许数字、运算符、括号、空格、小数点
  if (!/^[\d\s+\-*/().%^]+$/.test(replaced)) return 0

  // ^ → **
  const jsExpr = replaced.replace(/\^/g, "**")
  return Function(`"use strict"; return (${jsExpr})`)() as number
}

/** 求值 case 语句 */
function evalCase(stmt: string, env: Env): number {
  // case 表达式 [ when ... ]
  const caseMatch = stmt.match(/^case\s+(.+?)\s+\[\s*([\s\S]+?)\s*\]$/s)
  if (!caseMatch) return 0

  const subject = evalExpr(caseMatch[1].trim(), env)
  const body = caseMatch[2]

  // 解析 when 分支
  const branches = body.split(/\n/).map(l => l.trim()).filter(l => l)

  for (const branch of branches) {
    // when < N -> 表达式
    const ltMatch = branch.match(/^when\s+<\s+(\S+)\s+->\s+(.+)$/)
    if (ltMatch) {
      const threshold = evalExpr(ltMatch[1], env)
      if (subject < threshold) return evalExpr(ltMatch[2].trim(), env)
      continue
    }

    // when <= N -> 表达式
    const leMatch = branch.match(/^when\s+<=\s+(\S+)\s+->\s+(.+)$/)
    if (leMatch) {
      const threshold = evalExpr(leMatch[1], env)
      if (subject <= threshold) return evalExpr(leMatch[2].trim(), env)
      continue
    }

    // when > N -> 表达式
    const gtMatch = branch.match(/^when\s+>\s+(\S+)\s+->\s+(.+)$/)
    if (gtMatch) {
      const threshold = evalExpr(gtMatch[1], env)
      if (subject > threshold) return evalExpr(gtMatch[2].trim(), env)
      continue
    }

    // when >= N -> 表达式
    const geMatch = branch.match(/^when\s+>=\s+(\S+)\s+->\s+(.+)$/)
    if (geMatch) {
      const threshold = evalExpr(geMatch[1], env)
      if (subject >= threshold) return evalExpr(geMatch[2].trim(), env)
      continue
    }

    // when == N -> 表达式
    const eqMatch = branch.match(/^when\s+(?:==\s+)?(\S+)\s+->\s+(.+)$/)
    if (eqMatch && !branch.startsWith("when <") && !branch.startsWith("when >")) {
      const val = evalExpr(eqMatch[1], env)
      if (subject === val) return evalExpr(eqMatch[2].trim(), env)
      continue
    }

    // else 表达式
    const elseMatch = branch.match(/^else\s+(.+)$/)
    if (elseMatch) {
      return evalExpr(elseMatch[1].trim(), env)
    }
  }

  return 0
}

/** 拆分 math 的参数列表 */
function splitArgs(argsStr: string): string[] {
  const args: string[] = []
  let current = ""
  let depth = 0

  for (const ch of argsStr) {
    if (ch === "[") depth++
    else if (ch === "]") depth--

    if (depth === 0 && /\s/.test(ch) && current.trim()) {
      args.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }

  if (current.trim()) args.push(current.trim())
  return args
}

/** 在单行脚本中，在 case/set 等语句关键字前插入换行（排除字符串内的） */
function splitBeforeKeywords(line: string): string {
  let result = ""
  let inString = false
  let stringChar = ""
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inString) {
      result += ch
      if (ch === stringChar) inString = false
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      result += ch
      i++
      continue
    }

    // 在 "case " 前断行（如果前面有内容）
    if (i > 0 && line.substring(i).startsWith("case ") && result.trim()) {
      result += "\n"
    }

    result += ch
    i++
  }

  return result
}

/** 格式化单行 Kether 脚本为多行（用于编辑器显示） */
export function formatKetherScript(script: string): string {
  if (script.includes("\n")) return script

  let result = ""
  let inString = false
  let stringChar = ""
  let depth = 0

  for (let i = 0; i < script.length; i++) {
    const ch = script[i]

    if (inString) {
      result += ch
      if (ch === stringChar) inString = false
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      result += ch
      continue
    }

    if (ch === "[") {
      depth++
      result += "[\n" + "  ".repeat(depth)
      // 跳过 [ 后面的空格
      while (i + 1 < script.length && script[i + 1] === " ") i++
      continue
    }

    if (ch === "]") {
      depth--
      // 去掉 ] 前的尾部空格
      result = result.trimEnd()
      result += "\n" + "  ".repeat(depth) + "]"
      continue
    }

    // 在 case/set 前断行
    const rest = script.substring(i)
    if (i > 0 && (rest.startsWith("case ") || rest.startsWith("set ")) && result.trim() && !result.endsWith("\n")) {
      result += "\n"
    }

    // when/else 前断行
    if (rest.startsWith("when ") || rest.startsWith("else ")) {
      if (!result.endsWith("\n") && !result.endsWith("  ")) {
        result = result.trimEnd() + "\n" + "  ".repeat(depth)
      }
    }

    result += ch
  }

  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
