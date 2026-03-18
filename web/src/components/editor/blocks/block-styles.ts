// 积木块颜色和样式映射
import type { ASTNode } from "@/lib/kether-ast"

export const BLOCK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  action_call: { bg: "#2563eb", border: "#1d4ed8", text: "#ffffff" },
  set: { bg: "#16a34a", border: "#15803d", text: "#ffffff" },
  if: { bg: "#ea580c", border: "#c2410c", text: "#ffffff" },
  for: { bg: "#ea580c", border: "#c2410c", text: "#ffffff" },
  case: { bg: "#ea580c", border: "#c2410c", text: "#ffffff" },
  block: { bg: "#d97706", border: "#b45309", text: "#ffffff" },
  flag: { bg: "#9333ea", border: "#7e22ce", text: "#ffffff" },
  check: { bg: "#0891b2", border: "#0e7490", text: "#ffffff" },
  logic: { bg: "#0891b2", border: "#0e7490", text: "#ffffff" },
  math: { bg: "#0891b2", border: "#0e7490", text: "#ffffff" },
  calc: { bg: "#0891b2", border: "#0e7490", text: "#ffffff" },
  inline: { bg: "#db2777", border: "#be185d", text: "#ffffff" },
  lazy: { bg: "#16a34a", border: "#15803d", text: "#ffffff" },
  var_ref: { bg: "#16a34a", border: "#15803d", text: "#ffffff" },
  lazy_ref: { bg: "#16a34a", border: "#15803d", text: "#ffffff" },
  selector: { bg: "#d97706", border: "#b45309", text: "#ffffff" },
  number: { bg: "#6366f1", border: "#4f46e5", text: "#ffffff" },
  string: { bg: "#db2777", border: "#be185d", text: "#ffffff" },
  boolean: { bg: "#6366f1", border: "#4f46e5", text: "#ffffff" },
  identifier: { bg: "#525252", border: "#404040", text: "#e5e5e5" },
  comment: { bg: "#404040", border: "#333333", text: "#858585" },
  error: { bg: "#dc2626", border: "#b91c1c", text: "#ffffff" },
}

export function getBlockColor(node: ASTNode) {
  return BLOCK_COLORS[node.type] ?? BLOCK_COLORS.identifier
}

export function getBlockLabel(node: ASTNode): string {
  switch (node.type) {
    case "action_call": return node.name
    case "set": return `set ${node.variable}`
    case "if": return "if"
    case "for": return `for ${node.variable}`
    case "case": return "case"
    case "block": return node.modifier ?? "block"
    case "flag": return `flag ${node.operation}`
    case "check": return `check ${node.operator}`
    case "logic": return node.operator
    case "math": return `math ${node.operator}`
    case "calc": return "calc"
    case "inline": return "inline"
    case "lazy": return "lazy"
    case "var_ref": return node.key ? `&${node.name}[${node.key}]` : `&${node.name}`
    case "lazy_ref": return `*${node.name}`
    case "selector": return node.selectors.map(s => `${s.negated ? "!" : ""}@${s.name}`).join(" ")
    case "number": return String(node.value)
    case "string": return `"${node.value.length > 20 ? node.value.slice(0, 20) + "..." : node.value}"`
    case "boolean": return String(node.value)
    case "identifier": return node.name
    case "comment": return `# ${node.text}`
    case "error": return `ERROR: ${node.message}`
    default: return "?"
  }
}

// 判断节点是否有子块（可嵌套）
export function hasBody(node: ASTNode): boolean {
  return node.type === "if" || node.type === "for" || node.type === "case" || node.type === "block"
}
