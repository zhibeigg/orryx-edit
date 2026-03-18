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
| `triggers` | Trigger[] | 否 | 可监听事件列表（Station 编辑器用） |
| `selectors` | Selector[] | 否 | 选择器列表（`@选择器名` 补全用） |
| `properties` | Property[] | 否 | 属性对象列表（`&变量名[key]` 补全用） |

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

### Trigger（监听事件）

Station 编辑器使用 `triggers` 列表来提供事件选择下拉和变量提示。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 事件名称，如 `"Player Damaged Post"` |
| `category` | string | 是 | 分类，用于下拉列表分组 |
| `description` | string | 否 | 事件说明 |
| `variables` | Variable[] | 否 | 事件提供的变量列表 |

### Trigger Variable

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 变量名，在脚本中通过 `&event[name]` 访问 |
| `type` | string | 是 | 变量类型（`number` / `string` / `boolean` / `entity` / `location` / `itemstack`） |
| `description` | string | 否 | 变量说明 |

### Trigger Category 建议值

| 值 | 说明 |
|----|------|
| `bukkit-player` | Bukkit 玩家事件 |
| `bukkit-entity` | Bukkit 实体事件 |
| `bukkit-block` | Bukkit 方块事件 |
| `orryx-skill` | Orryx 技能相关事件 |
| `orryx-player` | Orryx 玩家属性事件（法力、精力、等级等） |
| `orryx-flag` | Orryx Flag 变更事件 |
| `orryx-job` | Orryx 职业事件 |
| `third-party` | 第三方插件事件（DragonCore、GermPlugin 等） |

### Trigger 示例

```json
{
  "triggers": [
    {
      "name": "Player Damaged Post",
      "category": "bukkit-player",
      "description": "玩家受到伤害后触发",
      "variables": [
        { "name": "damage", "type": "number", "description": "最终伤害值" },
        { "name": "cause", "type": "string", "description": "伤害原因（ENTITY_ATTACK, FALL 等）" },
        { "name": "damager", "type": "entity", "description": "攻击者实体（可能为空）" }
      ]
    },
    {
      "name": "Orryx Player Skill Cast",
      "category": "orryx-skill",
      "description": "玩家释放技能后触发",
      "variables": [
        { "name": "skill", "type": "string", "description": "技能 ID" },
        { "name": "level", "type": "number", "description": "技能等级" }
      ]
    },
    {
      "name": "Orryx Player Flag Change Post",
      "category": "orryx-flag",
      "description": "Flag 值变更后触发",
      "variables": [
        { "name": "flag", "type": "string", "description": "Flag 名称" },
        { "name": "oldValue", "type": "number", "description": "旧值" },
        { "name": "newValue", "type": "number", "description": "新值" }
      ]
    },
    {
      "name": "Dragon Key Press",
      "category": "third-party",
      "description": "DragonCore 按键按下",
      "variables": [
        { "name": "key", "type": "string", "description": "按键名称" }
      ]
    }
  ]
}
```

### 插件端生成 Trigger 参考

```kotlin
fun generateTriggers(): List<Map<String, Any?>> {
    return TriggerRegistry.getAll().map { trigger ->
        mapOf(
            "name" to trigger.eventKey,
            "category" to trigger.category,
            "description" to trigger.description,
            "variables" to trigger.variables.map { v ->
                mapOf(
                    "name" to v.name,
                    "type" to v.type.simpleName?.lowercase(),
                    "description" to v.description
                )
            }
        )
    }
}

// 在 generateActionsSchema() 中加入 triggers
fun generateActionsSchema(): String {
    return Json.encodeToString(mapOf(
        "version" to "1.0",
        "pluginVersion" to plugin.description.version,
        "actions" to generateActions(),
        "triggers" to generateTriggers()
    ))
}
```

### Selector（选择器）

编辑器使用 `selectors` 列表来提供 `@选择器名` 的补全和参数提示。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 选择器名称（不含 `@` 前缀），如 `"range"` |
| `aliases` | string[] | 否 | 别名列表，如 `["r"]` |
| `category` | string | 是 | 分类 |
| `description` | string | 是 | 选择器说明 |
| `params` | SelectorParam[] | 否 | 参数列表（按顺序） |
| `syntax` | string | 是 | 语法模板，如 `"@range [DOUBLE(5.0)] [DOUBLE(0.0)]"` |
| `examples` | string[] | 否 | 使用示例 |

### SelectorParam

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 参数类型（`DOUBLE`/`INT`/`BOOLEAN`/`STRING`/`VECTOR`） |
| `description` | string | 是 | 参数说明 |
| `default` | string | 否 | 默认值 |

### Selector Category 建议值

| 值 | 说明 |
|----|------|
| `geometry` | 几何选择器（范围、扇形、环形等） |
| `entity` | 实体选择器（自身、目标、队友等） |
| `location` | 位置选择器（原点、脚下、视线等） |
| `filter` | 过滤选择器（排除、类型过滤等） |
| `composite` | 组合选择器 |

### Selector 示例

```json
{
  "selectors": [
    {
      "name": "range",
      "aliases": ["r"],
      "category": "geometry",
      "description": "球形范围选择器，选取范围内的实体",
      "params": [
        { "type": "DOUBLE", "description": "半径", "default": "5.0" },
        { "type": "DOUBLE", "description": "y轴偏移", "default": "0.0" }
      ],
      "syntax": "@range [DOUBLE(5.0)] [DOUBLE(0.0)]",
      "examples": ["@range 5", "@range 10 2"]
    },
    {
      "name": "frustum",
      "category": "geometry",
      "description": "圆台形范围选择器",
      "params": [
        { "type": "DOUBLE", "description": "上半径", "default": "1.0" },
        { "type": "DOUBLE", "description": "下半径", "default": "10.0" },
        { "type": "DOUBLE", "description": "仰角", "default": "10.0" },
        { "type": "DOUBLE", "description": "偏航角", "default": "0" },
        { "type": "DOUBLE", "description": "y轴偏移", "default": "0.0" },
        { "type": "BOOLEAN", "description": "跟随pitch", "default": "false" }
      ],
      "syntax": "@frustum [DOUBLE(1.0)] [DOUBLE(10.0)] [DOUBLE(10.0)] [DOUBLE(0)] [DOUBLE(0.0)] [BOOLEAN(false)]",
      "examples": ["@frustum 1 5 10 0 1 false"]
    },
    {
      "name": "self",
      "category": "entity",
      "description": "选择自身",
      "params": [],
      "syntax": "@self"
    },
    {
      "name": "lookat",
      "aliases": ["look"],
      "category": "location",
      "description": "视线目标，选取准星正对的实体",
      "params": [
        { "type": "DOUBLE", "description": "最大距离", "default": "32.0" },
        { "type": "DOUBLE", "description": "角度容差", "default": "5.0" }
      ],
      "syntax": "@lookat [DOUBLE(32.0)] [DOUBLE(5.0)]",
      "examples": ["@lookat 32 5"]
    }
  ]
}
```

### Property（属性对象）

编辑器使用 `properties` 列表来提供 `&变量名[key]` 的属性补全。当用户输入 `&变量名[` 时，根据变量类型匹配对应的 Property，弹出属性 key 列表。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 属性对象名称，如 `"Location"` |
| `id` | string | 是 | 属性操作符 ID，如 `"orryx.location.operator"` |
| `category` | string | 是 | 分类 |
| `description` | string | 否 | 属性对象说明 |
| `usage` | string | 否 | 用法说明，如 `"&变量名[key]"` |
| `keys` | PropertyKey[] | 是 | 属性键列表 |

### PropertyKey

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 属性键名，如 `"x"`、`"health"` |
| `type` | string | 是 | 值类型（`STRING`/`INT`/`DOUBLE`/`FLOAT`/`BOOLEAN`/`VECTOR`/`ANY`） |
| `writable` | boolean | 是 | 是否可写（`set &变量名[key] to 值`） |
| `description` | string | 否 | 属性说明 |

### Property Category 建议值

| 值 | 说明 |
|----|------|
| `game` | 原版游戏对象（Location、Entity、ItemStack 等） |
| `orryx-player` | Orryx 玩家相关（Profile、Skill 等） |
| `orryx-combat` | Orryx 战斗相关（DamageProcessor 等） |
| `keysetting` | 按键设置 |
| `third-party` | 第三方插件对象 |

### Property 示例

```json
{
  "properties": [
    {
      "name": "Location",
      "id": "orryx.location.operator",
      "category": "game",
      "description": "Bukkit Location 对象，包含坐标、朝向和世界信息",
      "usage": "&变量名[key]",
      "keys": [
        { "name": "x", "type": "DOUBLE", "writable": true, "description": "X 坐标" },
        { "name": "y", "type": "DOUBLE", "writable": true, "description": "Y 坐标" },
        { "name": "z", "type": "DOUBLE", "writable": true, "description": "Z 坐标" },
        { "name": "yaw", "type": "FLOAT", "writable": true, "description": "偏航角" },
        { "name": "pitch", "type": "FLOAT", "writable": true, "description": "俯仰角" },
        { "name": "world", "type": "STRING", "writable": false, "description": "世界名称" },
        { "name": "blockX", "type": "INT", "writable": false, "description": "方块 X 坐标" },
        { "name": "blockY", "type": "INT", "writable": false, "description": "方块 Y 坐标" },
        { "name": "blockZ", "type": "INT", "writable": false, "description": "方块 Z 坐标" },
        { "name": "direction", "type": "VECTOR", "writable": false, "description": "方向向量" },
        { "name": "length", "type": "DOUBLE", "writable": false, "description": "到原点距离" }
      ]
    },
    {
      "name": "IEntity",
      "id": "orryx.entity.operator",
      "category": "game",
      "description": "实体对象",
      "usage": "&变量名[key]",
      "keys": [
        { "name": "uniqueId", "type": "STRING", "writable": false, "description": "实体 UUID" },
        { "name": "entityId", "type": "INT", "writable": false, "description": "实体数值 ID" },
        { "name": "health", "type": "DOUBLE", "writable": true, "description": "当前生命值" },
        { "name": "maxHealth", "type": "DOUBLE", "writable": false, "description": "最大生命值" },
        { "name": "name", "type": "STRING", "writable": false, "description": "实体名称" },
        { "name": "location", "type": "LOCATION", "writable": false, "description": "实体位置" }
      ]
    },
    {
      "name": "IBindKey",
      "id": "bindKey.operator",
      "category": "keysetting",
      "description": "按键绑定对象",
      "usage": "&变量名[key]",
      "keys": [
        { "name": "key", "type": "STRING", "writable": false, "description": "按键绑定的键名" },
        { "name": "name", "type": "STRING", "writable": false, "description": "同 key" },
        { "name": "sort", "type": "INT", "writable": false, "description": "排序权重" }
      ]
    }
  ]
}
```

### 插件端生成 Selector 和 Property 参考

```kotlin
fun generateSelectors(): List<Map<String, Any?>> {
    return SelectorRegistry.getAll().map { sel ->
        mapOf(
            "name" to sel.name,
            "aliases" to sel.aliases,
            "category" to sel.category,
            "description" to sel.description,
            "params" to sel.params.map { p ->
                mapOf(
                    "type" to p.type.name,
                    "description" to p.description,
                    "default" to p.default
                )
            },
            "syntax" to sel.syntax,
            "examples" to sel.examples
        )
    }
}

fun generateProperties(): List<Map<String, Any?>> {
    return PropertyOperatorRegistry.getAll().map { prop ->
        mapOf(
            "name" to prop.name,
            "id" to prop.id,
            "category" to prop.category,
            "description" to prop.description,
            "usage" to prop.usage,
            "keys" to prop.keys.map { k ->
                mapOf(
                    "name" to k.name,
                    "type" to k.type.name,
                    "writable" to k.writable,
                    "description" to k.description
                )
            }
        )
    }
}

// 完整的 generateActionsSchema()
fun generateActionsSchema(): String {
    return Json.encodeToString(mapOf(
        "version" to "1.0",
        "pluginVersion" to plugin.description.version,
        "actions" to generateActions(),
        "triggers" to generateTriggers(),
        "selectors" to generateSelectors(),
        "properties" to generateProperties()
    ))
}
```

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
7. **Station 事件选择**：`triggers` 列表按 `category` 分组显示在下拉菜单中
8. **事件变量提示**：选中事件后显示该事件提供的 `variables`，提示 `&event[变量名]` 用法
9. **选择器补全**：输入 `@` 时弹出 `selectors` 列表，显示参数和默认值
10. **属性补全**：输入 `&变量名[` 时弹出对应 Property 的 `keys` 列表，区分可读/可写
