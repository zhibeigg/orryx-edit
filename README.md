# Orryx Editor

面向 Minecraft 服主与 Orryx 开发者的商业化配置变更控制平台。浏览器通过 Ktor 服务管理账户、服务器实例、云端草稿、AI Job、审核、签名发布和不可变历史；Orryx 插件负责最终的签名验证、文件事务、主线程激活、Readiness 与崩溃恢复。

当前版本：`0.8.6`，数据库 Schema：`12`，Editor 协议：V1/V2。

## 核心边界

- AI 只能调用私有 Creation Suite Runner 的 `generate`、`validate`、`plan`，输出只进入云端草稿。
- AI 永远不能调用 `materialize`、生产文件写入、插件 reload、服务器命令或 Shell。
- 只有已登录账户点击发布并通过归属/RBAC 校验后，服务端才会创建签名发布事务。
- 插件只交换 Editor allowlist 文件，不替换整个 `plugins/Orryx`；`config.yml`、数据库、`.editor` 身份和事务数据不进入发布集合。
- 历史回退只会从旧 Snapshot 创建新草稿，不直接覆盖生产文件。
- Provider API Key、支付宝私钥、Runner secret、发布签名私钥只来自服务端环境，不进入前端、数据库明文字段、响应或日志。

## 架构

```text
账户浏览器
  │ HTTPS / Cookie + CSRF
  ▼
Orryx Editor Server (Ktor)
  ├── PostgreSQL / R2DBC（Schema v12）
  ├── AI Provider（服务端密钥）
  ├── 私有 Creation Suite Runner
  ├── 官方 Kether stable Schema
  └── V2 Relay ── WebSocket ── Orryx Plugin
                                  ├── Ed25519 验签
                                  ├── staging / backup / journal
                                  ├── Bukkit 主线程激活
                                  └── async Readiness / rollback / recovery
```

Web 使用 React 19、TypeScript、Vite、Monaco、React Flow 和 Three.js。服务端使用 Kotlin、Ktor 3、协程与 R2DBC PostgreSQL。插件端兼容 Minecraft 1.12–1.21。

## 用户流程

1. 在 `/portal` 注册或登录邮箱账户。
2. 认领已有 License，并等待插件注册稳定的 `serverInstance`。
3. 从 Server Snapshot 创建云端 Draft。
4. 在工作台选择 `GENERATE`、`VALIDATE` 或 `PLAN`，AI Job 经 Provider 与私有 Runner 生成不可变 Draft Version。
5. 在 Monaco Diff 中审核文件、diagnostics、checks、references 与 requirements。
6. 用户显式发布当前已审核版本。
7. 服务端签名完整目标 Manifest，插件执行 prepare → commit → readiness。
8. 成功生成 Release Snapshot；失败自动回滚或进入 `RECOVERY_REQUIRED`。
9. 从历史恢复时创建新草稿，再次走审核与发布。

## 页面

- `/`：兼容的实时 Editor 连接入口。
- `/portal`：账户、License 认领、服务器、钱包、订单与工作台入口。
- `/workspaces/{workspaceId}/servers/{serverInstanceId}`：AI 三栏工作台、审核发布和历史。
- `/admin`：License、更新、Kether 文档、AI Provider 与商业运行状态。

复杂编辑工作台以桌面端为主；窄屏使用分栏标签切换，不隐藏审核、历史或失败恢复入口。

## Feature Flags

所有商业能力默认关闭，并按依赖 fail-closed：

```text
EDITOR_PROTOCOL_V2_ENABLED=false
EDITOR_V2_WRITES_ENABLED=false
ACCOUNTS_ENABLED=false
CLOUD_DRAFTS_ENABLED=false
AI_WORKBENCH_ENABLED=false
RUNNER_ENABLED=false
RELEASE_TRANSACTIONS_ENABLED=false
ALIPAY_ENABLED=false
```

启用发布事务还必须配置 HTTPS 数据面 URL 与 Ed25519 PKCS#8/X.509 密钥。完整变量见 `.env.example`。

## 数据库与迁移

PostgreSQL 是唯一主存储；应用启动时通过 advisory lock 和 checksum 执行迁移。Schema v12 包含：

- 账户、Cookie 会话、RBAC、License 认领、Workspace 与 Server Instance。
- 永久权益、产品、钱包余额与 append-only ledger、支付宝订单和事件。
- Provider 目录、AI Job、usage reservation、Job events 和 Runner execution。
- Snapshot、不可变 Draft Version 与文件。
- Signed Release、完整目标文件、插件事务、事件、传输授权和签名公钥 metadata。

数据库不可用、迁移 checksum 不匹配或签名配置不完整时，相关能力拒绝启动；不会回退到 JSON 或内存生产存储。

## 环境要求

- Java 21+
- Node.js 20+
- PostgreSQL 15+
- Git Bash（Windows 执行脚本时）

生产至少配置：

```text
ADMIN_KEY
DATABASE_URL
DATABASE_USER
DATABASE_PASSWORD
```

账户、AI、Runner、支付和发布配置均在 `.env.example` 中按功能分组。

## 构建与测试

完整构建：

```bash
bash build.sh
```

常用本地命令：

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run check:bundle
npm run check:secrets

cd ../server
./gradlew --no-daemon test build
```

真实 PostgreSQL 集成测试依赖：

```text
TEST_DATABASE_URL=r2dbc:postgresql://...
```

本地未配置时测试会明确条件跳过，不能视为真实 PostgreSQL 已通过。Playwright E2E 还要求先在 `127.0.0.1:19090` 启动连接 PostgreSQL 的打包服务，并设置匹配的 `E2E_ADMIN_KEY`。

Creation Suite 验收位于 `Orryx/agent-skills/orryx-creation-suite`，包括 pytest、合同 JSON 校验、递归越权拒绝与 eval subtests。Orryx 插件通过 `./gradlew build` 验证。

## 发布事务

服务端 canonical payload 固定为 `orryx-release-v1`，使用 JDK Ed25519 签名；插件使用本机可信公钥验证。V2 控制消息为：

- relay → plugin：`release.request`
- plugin → relay：`release.result`

数据面使用短期 Bearer Token 拉取 operations 和内容。Token、URL 和过期时间不进入签名；完整目标文件路径、base/content SHA、大小和目标 Manifest 进入签名。详细协议见 [`PLUGIN_API.md`](PLUGIN_API.md)。

## 部署

支持 source、launcher 和 container：

- launcher 可校验私有 Release、切换 JAR、检查 `/health/ready` 并自动恢复旧版本。
- container 模式不在容器内替换自身 JAR。
- 私有 Runner 应作为同机低权限进程或 sidecar 部署，只监听明确私网/本机地址。
- 反向代理只有在 `TRUSTED_PROXY_IPS` 中才被信任；生产启用 HTTPS、Secure Cookie 和 HSTS。

详见 [`deploy/README.md`](deploy/README.md)。

## 健康与管理

- `GET /health/live`
- `GET /health/ready`
- `GET /api/actions-schema`
- `/api/admin/*` 使用 `Authorization: Bearer <ADMIN_KEY>`

管理接口不会返回 Provider 密钥、支付私钥、Runner secret、发布签名私钥、AI 原始 Provider 请求/响应或 Release Transfer Token。
