# Orryx Actions Schema v2

## 基线文件

受版本控制的 schema 位于 `schemas/actions-schema.json`。它是编辑器的动作、选择器和触发器元数据基线，不由前端构建重新生成。

Vite 构建时会将该文件原样复制到服务端静态资源目录，最终可通过 `/actions-schema.json` 获取。开发和测试代码也必须直接读取 `schemas/actions-schema.json`，避免维护多个副本。

## 顶层结构

当前文件使用数值版本 `2`：

```json
{
  "version": 2,
  "types": {},
  "categories": {},
  "actions": [],
  "selectors": [],
  "triggers": []
}
```

| 字段 | 实际类型 | 说明 |
|---|---|---|
| `version` | `2` | schema 主版本 |
| `types` | `Record<string, TypeDefinition>` | 输入和输出类型的控件、颜色及数值步长定义 |
| `categories` | `Record<string, CategoryDefinition>` | action 分类的颜色和图标定义 |
| `actions` | `Action[]` | Kether action 及其重载；同名 action 可以出现多次 |
| `selectors` | `Selector[]` | `@selector` 的参数元数据 |
| `triggers` | `Trigger[]` | Station 事件及其变量元数据 |

当前 v2 基线没有 `pluginVersion`、`properties`、`syntax`、`examples` 或 v1 的 `params` 顶层约定；消费者不得假定这些字段存在。

## 类型与分类

### TypeDefinition

```json
{
  "widget": "number",
  "color": "#4FC3F7",
  "step": 0.1
}
```

- `widget`：编辑器控件类型。当前数据包含 `number`、`text`、`toggle`、`select`、`selector`、`vector3`、`location`、`matrix`、`duration`、`port`、`list`。
- `color`：编辑器展示颜色。
- `step`：可选，仅部分数值类型提供。

### CategoryDefinition

```json
{
  "color": "#EF5350",
  "icon": "mdi-sword-cross"
}
```

每个 action 的 `category` 必须能在顶层 `categories` 中找到对应定义。

## Action

真实 action 结构如下：

```json
{
  "name": "potion",
  "category": "game",
  "namespace": "orryx",
  "description": "设置药水效果",
  "builtin": true,
  "flow": "normal",
  "inputs": [
    {
      "name": "设置标识符",
      "key": "set",
      "type": "keyword",
      "required": true,
      "default": "set",
      "keyword": "set"
    },
    {
      "name": "效果",
      "key": "效果",
      "type": "text",
      "required": true,
      "default": null,
      "description": "效果"
    }
  ],
  "output": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | action 名；重载可共享同一名称 |
| `category` | string | 是 | 顶层 `categories` 中的键 |
| `namespace` | string | 是 | action 来源命名空间 |
| `description` | string | 是 | 功能说明 |
| `builtin` | boolean | 否 | 是否为内置 action |
| `flow` | `normal \| branch \| loop \| container` | 是 | 节点流类型 |
| `inputs` | `Input[]` | 是 | 有序输入定义 |
| `output` | `Output \| null` | 是 | 输出定义；无输出时为 `null` |
| `example` | string | 否 | 单个示例文本 |
| `slots` | `Slot[]` | 否 | 分支、循环或容器 action 的子流程槽位 |
| `provides` | `Provide[]` | 否 | action 向子流程提供的变量 |

### Input

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 展示名称 |
| `key` | string | 是 | 参数向导读写值时使用的稳定键 |
| `type` | string | 是 | 顶层 `types` 中的键 |
| `required` | boolean | 是 | 是否必填 |
| `default` | 任意值或 null | 是 | 默认值；没有默认值时为 `null` |
| `description` | string | 否 | 参数说明 |
| `keyword` | string | 否 | `keyword` 类型输入需要匹配的字面量 |

当前基线中的 Input 不包含 `options`、`min`、`max`、`step` 数据，消费者应将这些字段视为可选扩展，而不是 v2 必备字段。

### Output

```json
{ "type": "list", "description": "伤害处理器列表" }
```

`type` 必填，`description` 可选。`type` 应引用顶层 `types`。

### Slot

```json
{ "name": "then", "label": "条件为真", "multiple": true }
```

`name`、`label`、`multiple` 必填，`optional` 可选。

### Provide

```json
{ "name": "迭代变量", "key": "it", "type": "any", "description": "当前迭代元素" }
```

`name`、`key`、`type` 必填，`description` 可选。

## Selector

```json
{
  "name": "frustum",
  "description": "前方扇形范围的实体",
  "params": [
    { "name": "上半径", "key": "p0", "type": "number", "default": "1.0" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 不包含 `@` 的选择器名称 |
| `aliases` | string[] | 否 | 别名 |
| `description` | string | 是 | 选择器说明 |
| `params` | `SelectorParam[]` | 是 | 有序参数列表 |

SelectorParam 的 `name`、`key`、`type` 必填，`default` 可选；`type` 应引用顶层 `types`。

## Trigger

```json
{
  "name": "Player Bed Leave",
  "category": "bukkit-player",
  "description": "玩家离开床时触发",
  "variables": [
    { "name": "bed", "type": "selector", "description": "床的位置" }
  ]
}
```

Trigger 的 `name`、`category`、`description` 必填，`variables` 可选。变量的 `name`、`type`、`description` 均由当前基线提供；变量类型沿用 schema 类型名称。

## 兼容与校验

- 新代码以 v2 为基线；旧数据如需兼容，应先通过前端 `normalizeSchema` 转换。
- `web/src/lib/__tests__/actions-schema.contract.test.ts` 校验顶层版本、action 必填字段、分类引用和类型引用。
- `web/src/lib/__tests__/parameter-wizard.test.ts` 使用同一受控 schema 验证参数解析和文本往返。
- 修改 schema 时不得通过格式化、生成或替换操作覆盖来源数据；应保留原始 JSON 内容并同步更新契约测试。
