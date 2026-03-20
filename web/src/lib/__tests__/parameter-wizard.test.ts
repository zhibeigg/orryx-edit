/**
 * 参数向导解析测试 — 基于 Orryx 技能配置中的真实 Kether 语句
 *
 * 测试 parseLineValues 和 generateKetherText 的正确性：
 * - keyword 标识符匹配
 * - required 位置参数按顺序消费
 * - optional 参数以 key 作为标识符 + value
 * - 嵌套表达式（lazy、math、{ } 块等）
 * - 生成文本的往返一致性
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { parseLineValues, generateKetherText, findBestOverload } from "../parameter-wizard"
import type { ActionsSchemaV2, SchemaAction } from "@/types/schema"
import { normalizeSchema } from "@/types/schema"

// 加载真实 schema
const rawSchema = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../actions-schema.json"), "utf-8")
)
const schema: ActionsSchemaV2 = normalizeSchema(rawSchema)

/** 辅助：根据 action 名和行内容找到最佳重载 */
function findAction(name: string, line: string): SchemaAction {
  const action = findBestOverload(name, line, schema)
  if (!action) throw new Error(`找不到 action: ${name}`)
  return action
}

// ============================================================
// potion set — 来自 挥毫泼墨.yml / 摄灵墨痕.yml / 凝灵盾.yml
// ============================================================
describe("potion set", () => {
  const line = "potion set SLOW 20 level 3"
  const action = findAction("potion", line)

  it("应正确解析 keyword 标识符 set", () => {
    const vals = parseLineValues(line, action, schema)
    expect(vals["set"]).toBe("set")
  })

  it("应正确解析效果为 SLOW", () => {
    const vals = parseLineValues(line, action, schema)
    expect(vals["效果"]).toBe("SLOW")
  })

  it("应正确解析持续时间为 20", () => {
    const vals = parseLineValues(line, action, schema)
    expect(vals["持续时间"]).toBe("20")
  })

  it("应正确解析可选参数 level 为 3", () => {
    const vals = parseLineValues(line, action, schema)
    expect(vals["level"]).toBe("3")
  })

  it("无 level 时不应有 level 值", () => {
    const line2 = "potion set SLOW 20"
    const vals = parseLineValues(line2, action, schema)
    expect(vals["level"]).toBeUndefined()
  })

  it("potion set SLOW 12 level 5 — 来自寒剑袭月", () => {
    const line3 = "potion set SLOW 12 level 5"
    const vals = parseLineValues(line3, action, schema)
    expect(vals["效果"]).toBe("SLOW")
    expect(vals["持续时间"]).toBe("12")
    expect(vals["level"]).toBe("5")
  })

  it("potion set SLOW 8 level 5 — 来自凝灵盾", () => {
    const line4 = "potion set SLOW 8 level 5"
    const vals = parseLineValues(line4, action, schema)
    expect(vals["持续时间"]).toBe("8")
    expect(vals["level"]).toBe("5")
  })
})

// ============================================================
// runExtend — 来自 挥毫泼墨.yml / 摄灵墨痕.yml / 炼狱岩碎拳.yml
// ============================================================
describe("runExtend", () => {
  it("应正确解析可选参数 origin", () => {
    const line = "runExtend 治疗墨痕 origin &o"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["拓展名"]).toBe("治疗墨痕")
    expect(vals["origin"]).toBe("&o")
  })

  it("无 origin 时不应有 origin 值", () => {
    const line = "runExtend 子炼狱"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["拓展名"]).toBe("子炼狱")
    expect(vals["origin"]).toBeUndefined()
  })

  it("runExtend 子炼狱 origin &o — 来自炼狱岩碎拳", () => {
    const line = "runExtend 子炼狱 origin &o"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["拓展名"]).toBe("子炼狱")
    expect(vals["origin"]).toBe("&o")
  })

  it("runExtend 回蓝墨痕 origin &i — 来自摄灵墨痕", () => {
    const line = "runExtend 回蓝墨痕 origin &i"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["拓展名"]).toBe("回蓝墨痕")
    expect(vals["origin"]).toBe("&i")
  })
})

// ============================================================
// damage — 来自多个技能
// ============================================================
describe("damage", () => {
  it("damage lazy *damage false — 带 they/source/type 可选参数", () => {
    const line = 'damage lazy *damage false they "@range 3 !@self !@type ARMOR_STAND !@team" source "@self" type MAGIC'
    const action = findAction("damage", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["攻击数值"]).toBe("lazy *damage")
    expect(vals["攻击是否接入属性系统"]).toBe("false")
    expect(vals["they"]).toBe("@range 3 !@self !@type ARMOR_STAND !@team")
    expect(vals["source"]).toBe("@self")
    expect(vals["type"]).toBe("MAGIC")
  })

  it("damage lazy *damage false — 只有 they 和 source", () => {
    const line = 'damage lazy *damage false they &t1 source "@self" type MAGIC'
    const action = findAction("damage", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["攻击数值"]).toBe("lazy *damage")
    expect(vals["攻击是否接入属性系统"]).toBe("false")
    expect(vals["they"]).toBe("&t1")
    expect(vals["source"]).toBe("@self")
    expect(vals["type"]).toBe("MAGIC")
  })

  it("damage lazy *damage false they &a — 来自摄灵墨痕", () => {
    const line = 'damage lazy *damage false they &a source "@self" type MAGIC'
    const action = findAction("damage", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["they"]).toBe("&a")
    expect(vals["source"]).toBe("@self")
    expect(vals["type"]).toBe("MAGIC")
  })
})

// ============================================================
// entity ady — 来自 万剑曲.yml / 升龙影步.yml / 寒剑袭月.yml
// ============================================================
describe("entity ady", () => {
  it("entity ady 万剑曲bloom — 完整可选参数", () => {
    const line = 'entity ady 万剑曲bloom ARMOR_STAND gravity false timeout 45 viewer "@range 50" they "@origin"'
    const action = findAction("entity", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["ady"]).toBe("ady")
    expect(vals["实体名"]).toBe("万剑曲bloom")
    expect(vals["实体类型"]).toBe("ARMOR_STAND")
    expect(vals["gravity"]).toBe("false")
    expect(vals["timeout"]).toBe("45")
    expect(vals["viewer"]).toBe("@range 50")
    expect(vals["they"]).toBe("@origin")
  })

  it("entity ady 升龙影步 — 来自升龙影步.yml", () => {
    const line = 'entity ady 升龙影步 ARMOR_STAND gravity false timeout 20 viewer "@range 50" they "@origin"'
    const action = findAction("entity", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["实体名"]).toBe("升龙影步")
    expect(vals["实体类型"]).toBe("ARMOR_STAND")
    expect(vals["gravity"]).toBe("false")
    expect(vals["timeout"]).toBe("20")
    expect(vals["viewer"]).toBe("@range 50")
    expect(vals["they"]).toBe("@origin")
  })

  it("entity ady 寒剑袭月 — 带 inline 选择器", () => {
    const line = 'entity ady 寒剑袭月 ARMOR_STAND timeout 22 they "@current e @offset 0.5 -0.5 1 true false"'
    const action = findAction("entity", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["实体名"]).toBe("寒剑袭月")
    expect(vals["实体类型"]).toBe("ARMOR_STAND")
    expect(vals["timeout"]).toBe("22")
    expect(vals["they"]).toBe("@current e @offset 0.5 -0.5 1 true false")
    // gravity 未提供
    expect(vals["gravity"]).toBeUndefined()
  })
})

// ============================================================
// cooldown set — 来自 挥毫泼墨.yml
// ============================================================
describe("cooldown set", () => {
  it("cooldown set 0", () => {
    const line = "cooldown set 0"
    const action = findAction("cooldown", line)
    const vals = parseLineValues(line, action, schema)
    // schema 中 key 是 "set/to"
    expect(vals["set/to"]).toBe("set")
    expect(vals["冷却值"]).toBe("0")
  })
})

// ============================================================
// orryx level — 来自 UpLevelCheckAction
// ============================================================
describe("orryx level", () => {
  it("orryx level — 无 job 参数", () => {
    const line = "orryx level"
    const action = findAction("orryx", line)
    const vals = parseLineValues(line, action, schema)
    expect(vals["level"]).toBe("level")
    expect(vals["job"]).toBeUndefined()
  })
})

// ============================================================
// generateKetherText 往返测试
// ============================================================
describe("generateKetherText 往返", () => {
  it("potion set SLOW 20 level 3 → 生成 → 解析 → 一致", () => {
    const line = "potion set SLOW 20 level 3"
    const action = findAction("potion", line)
    const vals = parseLineValues(line, action, schema)
    const generated = generateKetherText(action, vals)
    expect(generated).toBe("potion set SLOW 20 level 3")
  })

  it("potion set SLOW 20 — 无可选参数", () => {
    const line = "potion set SLOW 20"
    const action = findAction("potion", line)
    const vals = parseLineValues(line, action, schema)
    const generated = generateKetherText(action, vals)
    expect(generated).toBe("potion set SLOW 20")
  })

  it("runExtend 治疗墨痕 origin &o → 往返", () => {
    const line = "runExtend 治疗墨痕 origin &o"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    const generated = generateKetherText(action, vals)
    expect(generated).toBe("runExtend 治疗墨痕 origin &o")
  })

  it("runExtend 子炼狱 — 无可选参数往返", () => {
    const line = "runExtend 子炼狱"
    const action = findAction("runExtend", line)
    const vals = parseLineValues(line, action, schema)
    const generated = generateKetherText(action, vals)
    expect(generated).toBe("runExtend 子炼狱")
  })

  it("cooldown set 0 → 往返", () => {
    const line = "cooldown set 0"
    const action = findAction("cooldown", line)
    const vals = parseLineValues(line, action, schema)
    const generated = generateKetherText(action, vals)
    expect(generated).toBe("cooldown set 0")
  })
})

// ============================================================
// findBestOverload — 重载选择
// ============================================================
describe("findBestOverload", () => {
  it("potion set → 选择 set 重载", () => {
    const action = findBestOverload("potion", "potion set SLOW 20", schema)
    expect(action).not.toBeNull()
    expect(action!.description).toContain("设置")
  })

  it("potion remove → 选择 remove 重载", () => {
    const action = findBestOverload("potion", "potion remove SLOW", schema)
    expect(action).not.toBeNull()
    expect(action!.description).toContain("删除")
  })

  it("potion clear → 选择 clear 重载", () => {
    const action = findBestOverload("potion", "potion clear", schema)
    expect(action).not.toBeNull()
    expect(action!.description).toContain("清除")
  })

  it("entity ady → 选择 ady 重载", () => {
    const action = findBestOverload("entity", "entity ady 模型 ARMOR_STAND", schema)
    expect(action).not.toBeNull()
    expect(action!.description).toContain("Ady")
  })

  it("entity spawn → 选择 spawn 重载", () => {
    const action = findBestOverload("entity", "entity spawn 名称 ZOMBIE", schema)
    expect(action).not.toBeNull()
    expect(action!.description).toContain("原版")
  })
})

// ============================================================
// 批量解析 Orryx 技能文件中的所有 action 行
// ============================================================
describe("批量解析 Orryx 技能 action 行", () => {
  // 从技能 yml 中提取的真实 action 行
  const skillLines = [
    // 万剑曲.yml
    'dragon ani to player 万剑曲 1.0 they "@self"',
    'entity ady 万剑曲bloom ARMOR_STAND gravity false timeout 45 viewer "@range 50" they "@origin"',
    'dragon sound send 万剑曲 技能/剑修/万剑曲.ogg PLAYERS they "@range 5 @self"',
    'damage lazy *damage false they "@range 3 !@self !@type ARMOR_STAND !@team" source "@self" type MAGIC',
    // 挥毫泼墨.yml
    "cooldown set 0",
    "potion set SLOW 20 level 3",
    'dragon modelEffect create 挥毫泼墨 挥毫泼墨 50 they "@self"',
    'dragon sound send 挥毫泼墨 技能/笔修/挥毫泼墨.ogg PLAYERS they "@range 10 @self"',
    "runExtend 治疗墨痕 origin &o",
    // 摄灵墨痕.yml
    "potion set SLOW 20 level 3",
    'entity ady 摄灵墨痕 ARMOR_STAND gravity false timeout 50 viewer "@range 50" they "@self"',
    'damage lazy *damage false they &a source "@self" type MAGIC',
    "runExtend 回蓝墨痕 origin &i",
    // 炼狱岩碎拳.yml
    'entity ady 炼狱岩碎拳 ARMOR_STAND gravity false timeout 50 viewer "@range 50" they "@floor"',
    'damage lazy *damage false they "@range 1.5 !@self !@type ARMOR_STAND !@team" source "@self" type MAGIC',
    // 升龙影步.yml
    'entity ady 升龙影步 ARMOR_STAND gravity false timeout 20 viewer "@range 50" they "@origin"',
    'damage lazy *damage false they "@range 3 !@self !@type ARMOR_STAND !@team" source "@self" type MAGIC',
    // 寒剑袭月.yml
    "potion set SLOW 12 level 5",
    'entity ady 寒剑袭月 ARMOR_STAND timeout 22 they "@current e @offset 0.5 -0.5 1 true false"',
    'damage lazy *damage false they &t1 source "@self" type MAGIC',
    // 凝灵盾.yml
    "potion set SLOW 8 level 5",
    'damage lazy *damage false they "@range 2 !@self !@type ARMOR_STAND !@team" source "@self" type MAGIC',
    // sleep
    "sleep 5",
    "sleep 100",
    "sleep 45",
  ]

  for (const line of skillLines) {
    it(`不应抛出异常: ${line.slice(0, 60)}${line.length > 60 ? "..." : ""}`, () => {
      const firstToken = line.trim().split(/\s+/)[0]
      const action = findBestOverload(firstToken, line, schema)
      if (!action) return // schema 中没有此 action（如 dragon），跳过
      expect(() => parseLineValues(line, action, schema)).not.toThrow()
    })
  }

  // 验证关键行的解析结果
  it("所有 potion set 行的 level 都应正确解析", () => {
    const potionLines = skillLines.filter(l => l.startsWith("potion set"))
    for (const line of potionLines) {
      const action = findBestOverload("potion", line, schema)!
      const vals = parseLineValues(line, action, schema)
      expect(vals["set"]).toBe("set")
      expect(vals["效果"]).toBeTruthy()
      expect(vals["持续时间"]).toBeTruthy()
      // level 如果出现在行中，应该被正确解析
      if (line.includes("level")) {
        expect(vals["level"]).toBeTruthy()
        expect(Number(vals["level"])).toBeGreaterThan(0)
      }
    }
  })

  it("所有 entity ady 行的 timeout 都应正确解析", () => {
    const entityLines = skillLines.filter(l => l.startsWith("entity ady"))
    for (const line of entityLines) {
      const action = findBestOverload("entity", line, schema)!
      const vals = parseLineValues(line, action, schema)
      expect(vals["ady"]).toBe("ady")
      expect(vals["实体名"]).toBeTruthy()
      expect(vals["实体类型"]).toBeTruthy()
      if (line.includes("timeout")) {
        expect(vals["timeout"]).toBeTruthy()
        expect(Number(vals["timeout"])).toBeGreaterThan(0)
      }
    }
  })

  it("所有 damage 行的 they 都应正确解析", () => {
    const damageLines = skillLines.filter(l => l.startsWith("damage"))
    for (const line of damageLines) {
      const action = findBestOverload("damage", line, schema)!
      const vals = parseLineValues(line, action, schema)
      expect(vals["攻击数值"]).toBeTruthy()
      expect(vals["攻击是否接入属性系统"]).toBe("false")
      expect(vals["they"]).toBeTruthy()
    }
  })

  it("所有 runExtend 行的 origin 应正确解析", () => {
    const extendLines = skillLines.filter(l => l.startsWith("runExtend"))
    for (const line of extendLines) {
      const action = findBestOverload("runExtend", line, schema)!
      const vals = parseLineValues(line, action, schema)
      expect(vals["拓展名"]).toBeTruthy()
      if (line.includes("origin")) {
        expect(vals["origin"]).toBeTruthy()
      }
    }
  })
})
