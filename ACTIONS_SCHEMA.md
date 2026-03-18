# Orryx Kether 语句描述规范 v1

## 概述

插件通过命令（如 `/orryx dump-actions`）生成一份 JSON 文件，描述所有可用的 Kether 语句。
编辑器读取此文件后自动生成：语法高亮关键字、自动补全列表、参数提示、悬浮文档。

## 传输方式

插件端连接中心服务器后，编辑器通过 WebSocket 请求获取：

```
请求: { "type": "actions.schema", "id": "req_1", "data": {} }
响应: { "type": "actions.schema.result", "id": "req_1", "data": { "version": "1.0", "actions": [...] } }
```

或者插件启动时主动推送一次。

## JSON 结构

```json
{
  "version": "1.0",
  "pluginVersion": "1.2.0",
  "actions": [
    {
      "name": "damage",
      "aliases": ["dmg"],
      "category": "combat",
      "description": "对目标造成伤害",
      "returnType": "void",
      "params": [
        {
          "name": "amount",
          "type": "number",
          "required": true,
          "description": "伤害数值，支持 Kether 表达式"
        },
        {
          "name": "type",
          "type": "enum",
          "required": false,
          "default": "PHYSICAL",
          "description": "伤害类型",
          "options": ["PHYSICAL", "MAGIC", "TRUE", "FIRE"]
        }
      ],
      "syntax": "damage <amount> [type <type>]",
      "examples": [
        "damage 10",
        "damage 10 type MAGIC",
        "damage calc &damage * 1.5"
      ]
    }
  ]
}
```

## 字段说明

### 顶层

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 规范版本，当前 `"1.0"` |
| `pluginVersion` | string | 是 | 插件版本号 |
| `actions` | Action[] | 是 | 语句列表 |

### Action

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 语句主名称，如 `"damage"` |
| `aliases` | string[] | 否 | 别名列表，如 `["dmg"]` |
| `category` | string | 是 | 分类，用于补全列表分组 |
| `description` | string | 是 | 语句功能描述 |
| `returnType` | string | 否 | 返回值类型，默认 `"void"` |
| `params` | Param[] | 否 | 参数列表 |
| `syntax` | string | 是 | 语法模板，`<>` 必填参数，`[]` 可选参数 |
| `examples` | string[] | 否 | 使用示例 |
| `deprecated` | boolean | 否 | 是否已废弃 |
| `since` | string | 否 | 引入版本 |

### Param

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 参数名 |
| `type` | string | 是 | 参数类型，见下方类型表 |
| `required` | boolean | 是 | 是否必填 |
| `default` | string | 否 | 默认值（可选参数时提供） |
| `description` | string | 否 | 参数说明 |
| `options` | string[] | 否 | 当 type 为 `"enum"` 时的可选值列表 |

### 参数类型 (Param.type)

| 类型 | 说明 | 编辑器行为 |
|------|------|------------|
| `number` | 数值 | 无特殊补全 |
| `string` | 字符串 | 无特殊补全 |
| `boolean` | 布尔值 | 补全 `true` / `false` |
| `enum` | 枚举 | 补全 `options` 列表 |
| `action` | 嵌套 Kether 语句 | 触发语句补全 |
| `selector` | 目标选择器 | 补全 `@self` `@target` 等 |
| `variable` | 变量引用 | 补全 `&` 前缀变量 |
| `duration` | 时间（tick） | 无特殊补全 |
| `vector` | 向量 `x,y,z` | 无特殊补全 |
| `material` | 材质名 | 可选：补全 Bukkit Material |

### Category 建议值

| 值 | 说明 |
|----|------|
| `combat` | 战斗相关（伤害、治疗、buff） |
| `movement` | 移动相关（冲刺、传送、击退） |
| `particle` | 粒子特效 |
| `sound` | 音效 |
| `entity` | 实体操作 |
| `world` | 世界操作 |
| `logic` | 逻辑控制（条件、循环、延迟） |
| `variable` | 变量操作 |
| `math` | 数学运算 |
| `selector` | 目标选择器 |
| `misc` | 其他 |

## 完整示例

```json
{
  "version": "1.0",
  "pluginVersion": "1.2.0",
  "actions": [
    {
      "name": "damage",
      "aliases": ["dmg"],
      "category": "combat",
      "description": "对目标造成伤害",
      "returnType": "void",
      "params": [
        { "name": "amount", "type": "number", "required": true, "description": "伤害数值" },
        { "name": "type", "type": "enum", "required": false, "default": "PHYSICAL", "options": ["PHYSICAL", "MAGIC", "TRUE", "FIRE"] }
      ],
      "syntax": "damage <amount> [type <type>]",
      "examples": ["damage 10", "damage 10 type MAGIC"]
    },
    {
      "name": "delay",
      "category": "logic",
      "description": "延迟执行后续语句",
      "returnType": "void",
      "params": [
        { "name": "ticks", "type": "duration", "required": true, "description": "延迟 tick 数" }
      ],
      "syntax": "delay <ticks>",
      "examples": ["delay 20"]
    },
    {
      "name": "cast",
      "category": "combat",
      "description": "释放另一个技能",
      "returnType": "void",
      "params": [
        { "name": "skill", "type": "string", "required": true, "description": "技能 ID" },
        { "name": "check", "type": "enum", "required": false, "default": "true", "options": ["true", "false"], "description": "是否检查释放条件" }
      ],
      "syntax": "cast <skill> [check <check>]",
      "examples": ["cast 刹那", "cast 刹那 check false"]
    },
    {
      "name": "particle",
      "category": "particle",
      "description": "播放粒子效果",
      "returnType": "void",
      "params": [
        { "name": "type", "type": "enum", "required": true, "options": ["FLAME", "HEART", "CRIT", "ENCHANT", "SMOKE", "CLOUD", "REDSTONE"], "description": "粒子类型" },
        { "name": "count", "type": "number", "required": false, "default": "1", "description": "粒子数量" },
        { "name": "offset", "type": "vector", "required": false, "default": "0,0,0", "description": "偏移量" },
        { "name": "speed", "type": "number", "required": false, "default": "0", "description": "粒子速度" }
      ],
      "syntax": "particle <type> [count <count>] [offset <offset>] [speed <speed>]",
      "examples": ["particle FLAME", "particle FLAME count 10 offset 1,1,1 speed 0.1"]
    },
    {
      "name": "range",
      "aliases": ["@range"],
      "category": "selector",
      "description": "范围选择器，选取范围内的实体",
      "returnType": "selector",
      "params": [
        { "name": "radius", "type": "number", "required": true, "description": "半径" },
        { "name": "shape", "type": "enum", "required": false, "default": "sphere", "options": ["sphere", "cylinder", "cube"], "description": "形状" }
      ],
      "syntax": "@range <radius> [shape <shape>]",
      "examples": ["@range 5", "@range 3 shape cylinder"]
    },
    {
      "name": "if",
      "category": "logic",
      "description": "条件判断",
      "returnType": "void",
      "params": [
        { "name": "condition", "type": "action", "required": true, "description": "条件表达式" },
        { "name": "then", "type": "action", "required": true, "description": "条件为真时执行" },
        { "name": "else", "type": "action", "required": false, "description": "条件为假时执行" }
      ],
      "syntax": "if <condition> then <then> [else <else>]",
      "examples": ["if check health > 50 then damage 10 else heal 5"]
    }
  ]
}
```

## 插件端实现建议

```kotlin
// 在插件中收集所有注册的 Kether Action，生成 schema
fun generateActionsSchema(): String {
    val actions = KetherActionRegistry.getAll().map { action ->
        mapOf(
            "name" to action.name,
            "aliases" to action.aliases,
            "category" to action.category,
            "description" to action.description,
            "params" to action.params.map { p ->
                mapOf(
                    "name" to p.name,
                    "type" to p.type.name.lowercase(),
                    "required" to p.required,
                    "default" to p.default,
                    "description" to p.description,
                    "options" to p.options
                )
            },
            "syntax" to action.syntax,
            "examples" to action.examples
        )
    }
    return Json.encodeToString(mapOf(
        "version" to "1.0",
        "pluginVersion" to plugin.description.version,
        "actions" to actions
    ))
}

// 在 WebSocket 消息处理中响应 actions.schema 请求
"actions.schema" -> {
    val schema = generateActionsSchema()
    ws?.send("""{"type":"actions.schema.result","id":"${msg.id}","data":$schema}""")
}
```

## 编辑器端使用

编辑器收到 schema 后会：

1. **语法高亮**：所有 `name` + `aliases` 注册为关键字
2. **自动补全**：输入时弹出语句列表，按 `category` 分组，显示 `description`
3. **参数提示**：输入语句名后，提示 `params` 列表和类型
4. **枚举补全**：`enum` 类型参数自动补全 `options`
5. **悬浮文档**：鼠标悬停显示 `syntax` + `description` + `examples`
6. **废弃提示**：`deprecated: true` 的语句显示删除线
