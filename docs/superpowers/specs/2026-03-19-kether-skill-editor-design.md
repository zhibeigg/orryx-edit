# Kether 技能编辑器设计规格

日期: 2026-03-19
状态: 已批准

## 1. 概述

为 Orryx Editor 开发两个核心功能：

1. **节点流编辑器** — 基于 React Flow 的可视化 Kether 脚本编辑器，schema 驱动全量 Action 支持，混合控制流模式（自上而下执行流 + 容器节点 + 数据连线）
2. **Monaco 参数向导** — 文本编辑器中的引导式参数输入，让零基础用户也能编写 Kether 脚本

两个编辑器通过共享的 AST 中间层实现实时双向同步。

### 1.1 设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 编辑器类型 | Blockly / 增强树 / 节点流 | 节点流 | 数据流可视化最强 |
| Action 覆盖范围 | 全量 / 分层 / 核心子集 | 全量 | schema 驱动自动生成 |
| 控制流模式 | 执行流双线 / 容器 / 混合 | 混合 | 兼顾直观性和表达力 |
| 视图同步 | 实时双向 / 单向 / 模式锁定 | 实时双向 | 体验最好 |
| 文本编辑器增强 | 引导式输入 / 模板系统 / 两者 | 引导式输入 | 降低门槛最有效 |
| 实现方案 | React Flow+内联 / 自建 / React Flow+面板 | React Flow+内联 | 成熟库+所见即所得 |

## 2. actions-schema.json v2 标准

现有 schema v1 为 Monaco 补全设计，字段不足。v2 增加类型系统、端口定义、控制流元数据、UI 控件提示。

### 2.1 顶层结构

```json
{
  "version": 2,
  "types": { },
  "categories": { },
  "actions": [ ],
  "selectors": [ ],
  "triggers": [ ]
}
```

### 2.2 类型定义

```json
{
  "types": {
    "DOUBLE":    { "widget": "number",   "color": "#6366f1" },
    "INT":       { "widget": "number",   "color": "#6366f1", "step": 1 },
    "STRING":    { "widget": "text",     "color": "#db2777" },
    "BOOLEAN":   { "widget": "toggle",   "color": "#f59e0b" },
    "CONTAINER": { "widget": "selector", "color": "#d97706" },
    "VECTOR":    { "widget": "vector3",  "color": "#10b981" },
    "LOCATION":  { "widget": "location", "color": "#10b981" },
    "MATRIX":    { "widget": "matrix",   "color": "#8b5cf6" },
    "DURATION":  { "widget": "duration", "color": "#06b6d4" },
    "ACTION":    { "widget": "port",     "color": "#3b82f6" },
    "ENUM":      { "widget": "select",   "color": "#ec4899" },
    "ANY":       { "widget": "text",     "color": "#6b7280" },
    "LIST":      { "widget": "list",     "color": "#f97316" }
  }
}
```

### 2.3 分类定义

```json
{
  "categories": {
    "属性系统":  { "color": "#ef4444", "icon": "sword" },
    "效果系统":  { "color": "#8b5cf6", "icon": "sparkles" },
    "法力系统":  { "color": "#3b82f6", "icon": "droplet" },
    "容器操作":  { "color": "#d97706", "icon": "box" },
    "选择器":    { "color": "#f59e0b", "icon": "target" },
    "数学运算":  { "color": "#06b6d4", "icon": "calculator" },
    "控制流":    { "color": "#ea580c", "icon": "git-branch" },
    "变量":      { "color": "#16a34a", "icon": "variable" },
    "蓄力技能":  { "color": "#ec4899", "icon": "timer" },
    "兼容":      { "color": "#6b7280", "icon": "plug" }
  }
}
```

### 2.4 Action 定义

```json
{
  "name": "damage",
  "aliases": ["dmg"],
  "category": "属性系统",
  "namespace": "orryx",
  "description": "攻击目标，支持接入属性系统",
  "example": "damage 20 true they \"@range 5 !@self\" source \"@self\" type PHYSICS",
  "inputs": [
    {
      "name": "攻击数值",
      "key": "value",
      "type": "DOUBLE",
      "required": true,
      "default": null,
      "description": "造成的伤害数值"
    },
    {
      "name": "接入属性系统",
      "key": "attribute",
      "type": "BOOLEAN",
      "required": true,
      "default": true,
      "description": "是否经过属性系统计算"
    },
    {
      "name": "攻击目标",
      "key": "targets",
      "type": "CONTAINER",
      "required": true,
      "default": null,
      "description": "受击实体容器"
    },
    {
      "name": "攻击来源",
      "key": "source",
      "type": "CONTAINER",
      "keyword": "source",
      "required": false,
      "default": "@self",
      "description": "攻击发起者"
    },
    {
      "name": "攻击类型",
      "key": "type",
      "type": "ENUM",
      "keyword": "type",
      "required": false,
      "default": "PHYSICS",
      "options": ["PHYSICS", "MAGIC", "REAL"],
      "description": "伤害类型"
    }
  ],
  "output": {
    "type": "ANY",
    "description": "攻击结果"
  },
  "flow": "normal"
}
```

### 2.5 控制流 Action

```json
{
  "name": "if",
  "category": "控制流",
  "namespace": "kether",
  "description": "条件分支",
  "builtin": true,
  "inputs": [
    { "name": "条件", "key": "condition", "type": "BOOLEAN", "required": true }
  ],
  "output": null,
  "flow": "branch",
  "slots": [
    { "name": "then", "label": "成立", "multiple": true },
    { "name": "else", "label": "否则", "multiple": true, "optional": true }
  ]
}
```

```json
{
  "name": "for",
  "category": "控制流",
  "namespace": "kether",
  "description": "遍历循环",
  "builtin": true,
  "inputs": [
    { "name": "变量名", "key": "variable", "type": "STRING", "required": true },
    { "name": "迭代对象", "key": "iterable", "type": "ANY", "required": true }
  ],
  "output": null,
  "flow": "loop",
  "slots": [
    { "name": "body", "label": "循环体", "multiple": true }
  ],
  "provides": [
    { "name": "循环变量", "key": "$variable", "type": "ANY", "description": "当前迭代值" }
  ]
}
```

### 2.6 关键字段说明

| 字段 | 用途 |
|------|------|
| `flow` | `"normal"` 普通节点 / `"branch"` 分支容器 / `"loop"` 循环容器 / `"container"` 通用容器 |
| `slots` | 容器节点的子图插槽，`multiple: true` 表示可放多个子节点 |
| `provides` | 容器节点向子图注入的变量（如 for 的循环变量） |
| `keyword` | 参数的关键字前缀（生成文本时用 `keyword value` 格式） |
| `builtin` | 是否为 Kether 内置语法（前端硬编码处理） |
| `output` | 节点的输出端口类型，`null` 表示无数据输出 |
| `options` | ENUM 类型的可选值列表 |

### 2.7 Selector 定义

```json
{
  "name": "range",
  "aliases": [],
  "description": "范围内实体",
  "params": [
    { "name": "半径", "key": "radius", "type": "DOUBLE", "default": 10 }
  ]
}
```

## 3. 节点编辑器设计

基于 `@xyflow/react` (React Flow v12) 构建。

### 3.1 整体架构

```
┌─────────────────────────────────────────────────┐
│              ActionsEditor (容器)                 │
│  ┌──────────┐  模式切换  ┌───────────────────┐  │
│  │ 文本模式  │ ◄──────► │   节点模式         │  │
│  │ Monaco +  │          │   React Flow +     │  │
│  │ 参数向导  │          │   自定义节点        │  │
│  └─────┬─────┘          └────────┬───────────┘  │
│        │                         │               │
│        ▼                         ▼               │
│  ┌─────────────────────────────────────────┐    │
│  │         Kether AST (中间表示层)          │    │
│  │  parseKether() ◄──► stringifyKether()   │    │
│  │  parseKether() ◄──► astToFlow()         │    │
│  └─────────────────────────────────────────┘    │
│                      │                           │
│                      ▼                           │
│  ┌─────────────────────────────────────────┐    │
│  │       actions-schema.json v2 (元数据)    │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 3.2 节点类型

**ActionNode** (`flow: "normal"`):
- 头部：action 名称 + 分类颜色条 + 图标
- 输入端口区：每个 input 一行（端口圆点 + 名称 + 内联控件）
- 输出端口：底部右侧（如果 output 非 null）
- 内联控件根据 schema `types.widget` 渲染：
  - `number` → 数字输入框（可选 min/max 滑块）
  - `text` → 文本输入框
  - `toggle` → 开关
  - `select` → 下拉选择
  - `selector` → 选择器构建器按钮
  - `port` → 仅显示连接端口（接受连线输入）

**BranchNode** (`flow: "branch"`, 如 if):
- 头部：if + 条件输入端口
- slots 渲染为可展开的容器区域
- 子节点在容器内自上而下排列

**LoopNode** (`flow: "loop"`, 如 for):
- 头部：for + 变量名输入 + 迭代对象端口
- provides 变量显示为容器内可用的数据源
- 循环体容器区域

**DataNode** (纯数据节点):
- 变量引用 `&var` → 绿色小节点，输出端口
- 字面量 `123` / `"text"` → 紫色/粉色小节点
- calc 表达式 → 公式输入框 + 输出端口

### 3.3 连线规则

- 数据连线：从输出端口 → 输入端口，类型兼容时允许连接（ANY 兼容所有类型）
- 同类型端口颜色一致，方便用户识别
- 连线时高亮所有兼容的目标端口，不兼容的灰显
- 不需要显式执行流连线——同一层级节点按垂直位置从上到下执行

### 3.4 节点面板（左侧）

- 按 schema `categories` 分组显示所有可用节点
- 搜索框支持名称/别名/描述模糊搜索
- 拖拽节点到画布创建实例
- 常用节点置顶 / 最近使用记录
- 内置控制流节点单独分组

### 3.5 画布交互

- 拖拽平移、滚轮缩放、框选多节点
- 右键上下文菜单：删除、复制、断开连线
- Ctrl+Z / Ctrl+Y 撤销/重做（基于 AST diff）
- 自动布局按钮（dagre 算法，自上而下排列）
- Minimap 缩略图导航

## 4. 双向同步机制

### 4.1 数据流

```
文本编辑 ──► parseKether() ──► AST ──► astToFlow() ──► React Flow State
                                                            │
React Flow State ──► flowToAst() ──► AST ──► stringifyKether() ──► 文本更新
```

### 4.2 Flow 数据模型

```typescript
interface KetherNodeData {
  schemaAction: SchemaAction
  inputs: Record<string, any>
  slotChildren: Record<string, string[]>
  provides?: Record<string, string>
  astRef?: ASTNode
}

interface KetherEdgeData {
  sourcePort: string
  targetPort: string
  dataType: string
}
```

### 4.3 AST → Flow 转换规则

| AST 节点 | Flow 节点 | 说明 |
|----------|----------|------|
| `action_call` | ActionNode | inputs 从 args/keywordArgs 提取值 |
| `set` | SetNode（内置） | variable → 输入，value → 数据连线或内联值 |
| `if` | BranchNode | condition → 输入端口，thenBody/elseBody → slot 子节点 |
| `for` | LoopNode | variable/iterable → 输入，body → slot 子节点 |
| `var_ref` | DataNode | 输出端口连接到引用它的节点 |
| `number/string/boolean` | 内联值 | 不生成独立节点，直接写入目标节点的 inputs |
| `calc` | CalcNode（内置） | formula → 输入，结果 → 输出端口 |

### 4.4 同步策略

- 文本 → 节点：300ms 防抖，解析失败时保持上一次有效状态，底部显示错误提示
- 节点 → 文本：即时同步（每次节点操作后立即 flowToAst → stringify）
- 节点位置保持：astToFlow 时，如果节点 ID 匹配已有节点，保留其 x/y 坐标；新节点用 dagre 自动布局
- 节点 ID 生成：基于 AST 节点的 `start.offset` + action name 生成稳定 ID

### 4.5 撤销/重做

- 维护一个 AST 快照栈（不是 Flow State 栈，AST 更紧凑）
- Ctrl+Z → pop AST 快照 → 同时更新文本和节点图
- 两个视图共享同一个撤销栈

## 5. Monaco 参数向导

### 5.1 触发方式

- 从补全列表选中一个 action 后，自动弹出参数向导
- 光标停在已有 action 名称上时，按 `Ctrl+Shift+Space` 手动触发
- 点击 action 名称左侧的 CodeLens 图标触发

### 5.2 向导 UI

通过 Monaco `addOverlayWidget` API 挂载 React 组件，位置跟随光标所在 action 的文本位置。

```
┌─────────────────────────────────────────┐
│  damage  攻击目标                    ✕  │
│  ─────────────────────────────────────  │
│  攻击数值     [  20          ] DOUBLE   │
│  接入属性系统  [■ 开启]        BOOLEAN  │
│  攻击目标     [ @range 5 ▼  ] CONTAINER │
│  ─── 可选参数 ──────────────────────── │
│  攻击来源     [ @self    ▼  ] CONTAINER │
│  攻击类型     [ PHYSICS  ▼  ] ENUM      │
│  ─────────────────────────────────────  │
│  [插入]  [取消]           预览: ↓       │
│  damage 20 true they "@range 5"         │
└─────────────────────────────────────────┘
```

### 5.3 参数控件映射

| schema widget | 渲染控件 |
|---------------|---------|
| `number` | 数字输入框（有 min/max 时显示滑块） |
| `text` | 文本输入框 |
| `toggle` | 开关 |
| `select` | 下拉选择（options 列表） |
| `selector` | 选择器构建器按钮（弹出子面板） |
| `duration` | 数字 + 单位选择（tick/秒） |
| `vector3` | 三个数字输入框（x, y, z） |

### 5.4 选择器构建器

CONTAINER 类型专用子面板，从 schema 的 `selectors` 列表动态生成：

```
┌─────────────────────────────┐
│  选择器构建器                │
│  [+@range] [+@type] [+@self]│
│  ───────────────────────── │
│  ● @range  半径: [ 5  ]     │
│  ● !@self  (排除自己)       │
│  ───────────────────────── │
│  预览: "@range 5 !@self"    │
│  [确定]                     │
└─────────────────────────────┘
```

### 5.5 关键特性

- 必填参数在上方，可选参数折叠在"可选参数"区域（默认收起）
- 底部实时预览生成的 Kether 文本
- 点击"插入"将生成的文本替换当前行，光标移到末尾
- 编辑已有 action 时，向导自动回填当前参数值

## 6. 文件结构与依赖

### 6.1 新增依赖

```
@xyflow/react    — React Flow v12 节点编辑器
dagre            — 自动布局算法
```

### 6.2 文件变更

```
web/src/
├── components/editor/
│   ├── flow/                          ← 新增：节点编辑器
│   │   ├── FlowEditor.tsx             — 主画布（React Flow 容器 + 工具栏）
│   │   ├── FlowMinimap.tsx            — 缩略图导航
│   │   ├── NodePalette.tsx            — 左侧节点面板（分类 + 搜索 + 拖拽）
│   │   ├── flow-types.ts             — KetherNodeData / KetherEdgeData 类型
│   │   └── nodes/                     — 自定义节点组件
│   │       ├── ActionNode.tsx         — 普通 action 节点（内联参数控件）
│   │       ├── BranchNode.tsx         — 分支容器节点（if/case）
│   │       ├── LoopNode.tsx           — 循环容器节点（for）
│   │       ├── DataNode.tsx           — 数据节点（变量引用/字面量）
│   │       ├── SetNode.tsx            — set 变量节点
│   │       ├── CalcNode.tsx           — calc 表达式节点
│   │       └── node-styles.ts         — 节点样式（替代旧 block-styles.ts）
│   ├── ParameterWizard.tsx            ← 新增：参数向导浮层
│   ├── SelectorBuilder.tsx            ← 新增：选择器构建器
│   ├── ActionsEditor.tsx              ← 修改：集成 FlowEditor + 参数向导
│   ├── KetherBlockEditor.tsx          ← 删除（被 FlowEditor 替代）
│   └── blocks/                        ← 删除（被 nodes/ 替代）
│
├── lib/
│   ├── kether-flow.ts                 ← 新增：AST ↔ Flow 双向转换
│   ├── parameter-wizard.ts            ← 新增：向导生命周期 + 文本插入
│   ├── kether-ast.ts                  ← 保留，可能微调以支持更好的 round-trip
│   └── kether-language.ts             ← 修改：集成向导触发逻辑
│
├── types/
│   └── schema.ts                      ← 新增：Schema v2 类型定义
```

### 6.3 模块职责边界

| 模块 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| `kether-ast.ts` | Kether 文本 | AST | schema v2 |
| `kether-flow.ts` | AST | Flow Nodes/Edges（及反向） | schema v2, dagre |
| `FlowEditor.tsx` | Flow State | 用户交互事件 | @xyflow/react |
| `parameter-wizard.ts` | 光标位置 + schema | 向导面板状态 | Monaco API |
| `ActionsEditor.tsx` | Kether 文本 | onChange 回调 | 以上所有模块 |

### 6.4 ActionsEditor 模式切换改造

现有的 `text` / `blocks` 双模式改为 `text` / `flow` 双模式，共享同一个 AST 状态。切换时不重新解析，直接从内存中的 AST 渲染对应视图。
