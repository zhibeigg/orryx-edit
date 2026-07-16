# Orryx Actions Schema 动态契约

## 来源与运行时行为

Orryx Editor 0.16.26 不再把构建时 JSON 当作唯一数据源。服务端只读取 Orryx 官方 GitHub Pages 的 `stable` 通道：

```text
https://zhibeigg.github.io/Orryx/kether/channels/stable.json
```

同步链路固定为：

```text
stable channel
  -> immutable release manifest
  -> actions-schema.json
  -> PostgreSQL last-known-good cache
  -> GET /api/actions-schema
```

浏览器始终从本机服务端读取 Schema，不直接访问 GitHub Pages。服务端会在启动后立即检查一次，并默认每 12 小时重新检查。管理后台可以手动触发同步。

内置的 `schemas/actions-schema.json` 仍随 JAR 发布，但只作为首次启动或远端不可用时的最后可用基线。Vite 会将它复制到服务端静态资源；生产路由 `/actions-schema.json` 和 `/api/actions-schema` 都由动态 Schema 服务响应。

## 公共 HTTP 接口

### `GET /api/actions-schema`

返回当前通过校验的 Actions Schema。兼容入口 `GET /actions-schema.json` 返回相同内容。

响应头：

| Header | 说明 |
|---|---|
| `ETag` | 当前 Schema SHA-256，带双引号 |
| `Cache-Control` | `public, max-age=300, stale-while-revalidate=86400` |
| `X-Orryx-Kether-Source` | `remote`、`cache` 或 `bundled` |
| `X-Orryx-Kether-Release` | 当前不可变 `releaseId`，可用时返回 |

请求携带匹配的 `If-None-Match` 时返回 `304 Not Modified`。没有任何可用 Schema 时返回 `503`，不会返回未校验的远端内容。

编辑器在会话内只加载一次 Schema。后台同步成功后，新打开或刷新的编辑会话采用新版本；已经打开的会话不会中途切换。

## 管理 API

管理 API 均要求：

```text
Authorization: Bearer <ADMIN_KEY>
```

- `GET /api/admin/kether-docs/status`：读取同步状态、来源、版本、SHA、最近成功和下次检查时间。
- `POST /api/admin/kether-docs/sync`：立即执行一次完整 stable 同步并返回最新状态。

状态分为：

- `UP_TO_DATE`：最近一次远端同步成功，当前 Schema 已通过全部校验。
- `DEGRADED`：远端同步失败或尚未首次同步，但 PostgreSQL 缓存/JAR 基线仍可用。
- `FAILED`：远端、数据库缓存和 JAR 基线均不可用。

失败不会覆盖当前 last-known-good Schema。

## 顶层兼容与契约版本

动态文件保留编辑器既有的数值兼容入口 `version: 2`，并新增独立的发布契约版本 `schemaVersion: 3`：

```json
{
  "$schema": "https://zhibeigg.github.io/Orryx/kether/contracts/actions-schema-v3.schema.json",
  "version": 2,
  "schemaVersion": 3,
  "pluginId": "Orryx",
  "pluginVersion": "2.49.122",
  "commit": "40-character-git-sha",
  "types": {},
  "categories": {},
  "actions": [],
  "selectors": [],
  "triggers": [],
  "properties": []
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `2` | 旧编辑器的数据布局兼容版本 |
| `schemaVersion` | `3` | 动态发布契约版本；当前编辑器只接受 v3 |
| `pluginVersion` | string | 生成 Schema 的 Orryx 插件版本 |
| `commit` | string | 生成来源的完整 40 位 Git SHA |
| `types` | object | 参数/输出类型定义 |
| `categories` | object | action 分类定义 |
| `actions` | array | 完整运行时 action 注册表 |
| `selectors` | array | 完整 selector 注册表 |
| `triggers` | array | 完整 trigger 注册表 |
| `properties` | array | 完整 property 注册表 |

发布时间不属于 `actions-schema.json` 本体：远程同步以 stable channel 的 `publishedAt` 与不可变 release manifest 的 `generatedAt` 为可信来源；仅使用内置基线且尚无远程缓存时，管理状态中的 `publishedAt` 为 `null`。

## 稳定 ID

每个 action、selector、trigger 和 property 都包含永久稳定 ID：

```text
orryx.action.cooldown.set.0123456789ab
orryx.selector.self.0123456789ab
orryx.trigger.bukkit-player.player-join.0123456789ab
orryx.property.player
```

ID 只允许小写字母、数字、点、下划线和连字符。服务端会对四个集合执行全局唯一性检查；重复或非法 ID 会导致同步失败并继续使用旧缓存。

## Action

动态 Action 同时保留现有编辑器字段并补充运行时语义：

```json
{
  "id": "orryx.action.cooldown.set.0123456789ab",
  "name": "cooldown",
  "aliases": [],
  "category": "Cooldown冷却",
  "namespace": "orryx",
  "description": "设置冷却",
  "syntax": "cooldown set/to <LONG>",
  "examples": ["cooldown set 20"],
  "requirements": [],
  "suspends": false,
  "inputs": [
    {
      "name": "设置标识符",
      "key": "p0",
      "type": "keyword",
      "required": true,
      "default": "set",
      "keyword": "set/to"
    }
  ],
  "output": null,
  "flow": "normal"
}
```

前端语言服务同时接受历史 `params` 和当前 `inputs`；参数向导、Flow Editor 和补全均以 `inputs` 为主。Orryx 2.43.114 起，位置参数继续使用 input `name` 作为兼容 key，keyword 参数使用 keyword；前端兼容层也会把 2.43.113 过渡版中的 `p0/p1` 映射回 input `name`，从而保持既有向导状态和 YAML 往返契约。`output.type`、input 类型、selector 参数类型、trigger 变量类型和 property key 类型必须引用顶层 `types`。

`description` 是 Orryx Action 元数据的必填非空字段。Registry v4 与 Actions Schema v3 的生成、JSON Schema 和发布校验都会拒绝空白简介；节点库在鼠标悬停或键盘聚焦 Action 时显示该简介与语法。前端仅保留“暂未提供简介”的防御性回退，不将其写回或替代正式合同数据。

输入可以通过可选 `options: string[]` 声明当前槽位的有限值目录，类型也可以通过 `enumValues: string[]` 提供共享目录。Scratch 的解析优先级固定为 input `options`、类型 `enumValues`、keyword alternatives；三者都不存在时继续使用普通文本输入。有限值控件支持搜索、键盘导航和目录外自定义值，且可切换到 Raw 模式直接保存 Kether 片段，切换过程不得静默清空已有值。实体类型、药水效果、声音与材质目录由 Orryx 运行时 Registry/XSeries 元数据生成，Editor 不扫描 Kotlin 源码，也不维护人工复制的 Minecraft 枚举表。

### Kether Reader 与 grammar 边界

Orryx Editor 0.16.26 的 Action 解析游标与 TabooLib 6.3.0 `SimpleReader` / `KetherScriptLoader.Reader` 对齐：普通 token 只由空白分隔，`[`、`]`、`{`、`}` 由当前列表或匿名块解析器拥有并递归消费，因此 `&event[key]`、`player[name]` 不会被误识别成外层列表边界。`expect` 对必需的 `then`、`in` 和闭合符执行严格校验；失败时回滚并把完整、括号平衡的局部 Action 保存为 Raw，而不是留下孤立的 `]`、`}` 或 `then` 块。

`grammar.sequence` 可声明 `input`、`literal`、`localRaw`、`branch`、`optional` 与 `actionList`。`actionList` 对应 TabooLib 的 `ArgTypes.listOf(ArgTypes.ACTION)`，用于 `all`、`any`、`seq`、`await_all`、`await_any` 和 `array`。未声明完整 grammar 的 Action 继续使用 `localRawRemainder`，且 grammar 参数无法完整映射到公开 inputs 时必须整段 Raw 保真，禁止在保存时静默丢参。AST 额外记录关键字与位置参数的原始相对顺序，避免 `buff send <name> <duration>` 被重排；BlockDocument 则按 Schema inputs 顺序稳定输出，允许对文本引号做等价规范化，但不得丢失参数。

Orryx Editor 0.16.26 的 Flow Editor 直接使用唯一的 `input.key` 作为左侧数据输入 Handle ID，并使用固定的 `output`、`flow-in`、`flow-out` 标识数据输出和执行端口。Scratch 中的嵌套块使用内容驱动的最小宽度：内层块先保持字段可读宽度，父级逐层吸收标签列与间距，超出工作区后只由画布横向滚动，不允许父输入槽把子块压窄或裁切。节点真实尺寸、容器 slot 尺寸和自动布局坐标属于编辑器瞬态数据，不进入 Actions Schema，也不改变 Kether 文本语义。

分类中文名与 VS Code Dark+ 语义色只属于前端展示层。`action.category`、顶层 `categories` 键和远端 Registry 颜色继续保持原始合同值；未知分类也会保留原始 ID，因此本地化不会改变查找、解析、拖拽载荷或保存结果。

## Selector、Trigger 与 Property

Selector 包含 `id`、`name`、`aliases`、`description`、`syntax`、`examples` 和有序 `params`。

Trigger 包含 `id`、`name`、`category`、`description` 与 `variables`。

Property 包含 `id`、`name`、`category`、`description`、`usage` 与 `keys`；每个 key 声明类型、可写性和说明。

## 安全与完整性校验

同步必须同时满足：

1. 通道固定为 `stable`，格式版本为 1。
2. `releaseId = Orryx@<pluginVersion>+<commit>`。
3. 只允许 `https://zhibeigg.github.io/Orryx/kether/` 同源路径。
4. Release manifest 必须位于由版本与 commit 推导出的不可变目录。
5. Schema 资产名固定为 `actions-schema.json`，媒体类型为 JSON。
6. 通道指针最大 32 KiB、Manifest 最大 64 KiB、Schema 默认最大 4 MiB。
7. 实际字节数必须与 Manifest 完全一致。
8. SHA-256 必须与 Manifest 完全一致。
9. `version: 2`、`schemaVersion: 3`、插件版本和 commit 必须互相匹配。
10. 所有稳定 ID、分类引用和类型引用必须有效。

任何一步失败都不会更新 PostgreSQL 缓存。

## 受版本控制的内置基线

`schemas/actions-schema.json` 由 Orryx 插件完整运行时注册表生成，不由前端手工维护。更新基线时必须：

1. 在 Orryx 仓库运行 `generateKetherDocs`。
2. 运行 `scripts/validate-kether-docs.mjs`。
3. 将通过校验的 `kether/actions-schema.json` 复制到本仓库 `schemas/actions-schema.json`。
4. 运行前端契约测试和服务端 bundled fallback 测试。

`web/src/lib/__tests__/actions-schema.contract.test.ts` 校验 v2/v3 元数据、稳定 ID、分类和类型引用；后端测试覆盖 URL、大小、SHA、缓存回退、ETag 和管理鉴权。
