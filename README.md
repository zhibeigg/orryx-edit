# Orryx Editor

面向 Minecraft 服主与 Orryx 开发者的多人 Web 配置编辑器。浏览器通过中心 Ktor 服务与指定 Minecraft 子服建立隔离工作区，支持可恢复会话、协作者状态、文件版本冲突保护和受控在线更新。

## 技术栈

- Web：React 19、TypeScript、Vite 8、Tailwind CSS 4、Monaco、React Flow、Three.js
- Server：Kotlin、Ktor 3、Netty、协程
- 持久化：PostgreSQL、R2DBC PostgreSQL、R2DBC Pool
- 协议：HTTP JSON + WebSocket JSON

## 0.4.1 架构

```text
浏览器 ── /ws ──> Orryx Editor Server <── /ws/server ── Minecraft 插件
                       │
                       ├── PostgreSQL / R2DBC
                       ├── Orryx Kether stable 文档（官方 GitHub Pages）
                       └── 私有 GitHub Release（仅后端访问）
```

- PostgreSQL 是唯一主存储；不回退到 JSON 或内存。
- 旧 `licenses.json` 只在首次迁移时异步导入，原文件不会删除。
- `workspaceId = SHA-256(serverKey + NUL + serverId)`，同 License 的不同子服完全隔离。
- URL Token 只能原子消费一次；浏览器仅在 `sessionStorage` 保存可轮换的 resume token，数据库只保存 SHA-256。
- 浏览器请求 ID 会在 relay 内改写，插件响应只返回发起请求的浏览器。
- 文件写入携带 `baseRevision`；过期 revision 返回 `REVISION_CONFLICT`，不会静默覆盖。
- 在线更新只接受稳定版、精确资产、HTTPS allowlist 和匹配的 SHA-256/manifest。
- Kether Schema 只从 Orryx 官方 `stable` 通道同步；服务端校验不可变路径、契约、字节数与 SHA-256 后原子写入 PostgreSQL，失败继续使用 last-known-good 缓存。
- 浏览器只请求本机 `/api/actions-schema`，新会话采用新 Schema，已经打开的编辑会话不会中途切换。

## 环境要求

- Java 21+
- Node.js 20+
- PostgreSQL 15+
- Git Bash（Windows 执行 `build.sh` 时）

复制 `.env.example` 并设置环境变量。生产必填：

```text
ADMIN_KEY          至少 16 字符的随机管理密钥
DATABASE_URL       r2dbc:postgresql://host:5432/database
DATABASE_USER      PostgreSQL 用户
DATABASE_PASSWORD  PostgreSQL 密码
```

常用可选项：

```text
PORT=9090
DATA_DIR=data
DB_POOL_MIN_IDLE=1
DB_POOL_MAX_SIZE=10
EDITOR_SESSION_TTL_HOURS=24
DEPLOYMENT_MODE=source|launcher|container
UPDATE_ENABLED=false
UPDATE_GITHUB_REPOSITORY=zhibeigg/orryx-edit
UPDATE_GITHUB_TOKEN=<private repo read-only token>
KETHER_DOCS_SYNC_ENABLED=true
KETHER_DOCS_SYNC_INTERVAL_HOURS=12
KETHER_DOCS_REQUEST_TIMEOUT_SECONDS=20
KETHER_DOCS_MAX_SCHEMA_BYTES=4194304
```

完整配置见 `.env.example`。GitHub Token 只存在于服务端环境和 GitHub Authorization 请求头，不会进入前端、响应或日志。

## 数据库与迁移

应用启动顺序：

1. 校验配置和强管理密钥。
2. 建立 R2DBC Pool 并执行 `SELECT 1`。
3. 在事务中获取 PostgreSQL advisory lock。
4. 校验 `schema_migrations` checksum 并执行待应用迁移。
5. 尝试一次性导入旧 `licenses.json`。
6. 校验并恢复 PostgreSQL 中的 Kether Schema 缓存；没有缓存时读取 JAR 内置基线。
7. 启动 HTTP、WebSocket、会话清理和 Kether stable 同步任务。

迁移不使用 Flyway、JDBC 或阻塞数据库 API。数据库不可用、checksum 不匹配或迁移失败时服务拒绝启动。

## 构建与测试

```bash
bash build.sh
```

根构建会执行：

- `npm ci`
- ESLint、TypeScript、Vitest、Vite production build
- `./gradlew --no-daemon test shadowJar`

产物：

```text
server/build/libs/orryx-editor-server-A.B.C.jar
```

## 启动

### source / container 模式

```bash
ADMIN_KEY=... DATABASE_URL=... DATABASE_USER=... DATABASE_PASSWORD=... bash start.sh
```

Windows：

```powershell
$env:ADMIN_KEY="..."
$env:DATABASE_URL="r2dbc:postgresql://127.0.0.1:5432/orryx_editor"
$env:DATABASE_USER="orryx"
$env:DATABASE_PASSWORD="..."
.\start.ps1
```

### launcher 模式与自动回滚

设置：

```text
DEPLOYMENT_MODE=launcher
UPDATE_ENABLED=true
UPDATE_GITHUB_TOKEN=<read-only token>
```

Admin 后台可以检查、下载、校验并暂存 Release。应用请求重启后以退出码 `42` 退出；`start.sh`/`start.ps1` 会：

1. 再次校验 pending manifest 与 staged JAR SHA-256。
2. 备份当前 JAR。
3. 在旧进程退出后切换 JAR。
4. 启动新版本并轮询 `/health/ready`，同时核对版本。
5. 失败时终止新进程、恢复备份并启动旧版本。

`container` 模式不会在容器内替换 JAR，只允许检查新版本。

## Kether 文档自动同步

服务端启动后立即读取 `https://zhibeigg.github.io/Orryx/kether/channels/stable.json`，之后默认每 12 小时轮询。它只接受 Orryx 官方同源 HTTPS URL，并依次验证 channel、不可变 Release manifest、Schema v3、资源字节数、4 MiB 大小预算、SHA-256、稳定 ID 和类型引用。

同步成功后 Schema 与状态原子保存到 PostgreSQL；失败时不会覆盖当前可用版本。管理后台显示 `UP_TO_DATE`、`DEGRADED` 或 `FAILED`，并可手动触发 stable 同步。公共入口：

- `GET /api/actions-schema`
- `GET /actions-schema.json`（兼容入口）
- `GET /api/admin/kether-docs/status`
- `POST /api/admin/kether-docs/sync`

详细契约、响应头和回退语义见 [`ACTIONS_SCHEMA.md`](ACTIONS_SCHEMA.md)。

## CI/CD 与发布

`.github/workflows/ci.yml` 在 Pull Request 和 `master` push 上执行。前端关键解析模块当前覆盖率基线为语句 60%、分支 40%、函数 55%、行 60%，CI 会拒绝低于基线的变更：

- 前端 lint、typecheck、覆盖率测试、bundle budget 和静态资源 secret scan
- 后端单元测试、JUnit 报告和真实 PostgreSQL 集成测试
- clean fat JAR 打包、静态资源/版本 smoke test
- Playwright 360/768/1024/1440 响应式与 axe 无障碍检查

`.github/workflows/release.yml` 在 `vA.B.C` tag 或手动触发时校验 tag 与根 `VERSION` 一致，生成 JAR、SHA-256、`update-manifest.json`、launcher 部署包和可选 GHCR 镜像。Actions 使用最小权限、并发控制和固定 commit SHA；Dependabot 维护 action/npm/Gradle/Docker 更新。

常用本地质量命令：

```bash
cd web
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run check:bundle
npm run check:secrets
npm run e2e          # 需要已运行的测试服务

cd ../server
./gradlew --no-daemon test shadowJar
```

容器与 systemd/launcher 部署见 `deploy/README.md`。Docker Compose 使用非 root、只读根文件系统，并在 container 模式下禁用原地 JAR 替换。

## 健康检查

- `GET /health/live`：进程存活和版本。
- `GET /health/ready`：真实 PostgreSQL 可用性、迁移完成状态、可用 Kether Schema 和版本；缓存降级仍为 ready，三种来源均不可用时返回 not-ready。

## 页面与管理 API

- `/`：编辑器连接与工作区
- `/admin`：License、运行状态和在线更新
- `/portal`：License 自助信息与 IP 解绑
- `GET /api/admin/system/version`
- `GET /api/admin/update/status`
- `POST /api/admin/update/jobs`
- `GET /api/admin/update/jobs/{id}`
- `GET /api/admin/kether-docs/status`
- `POST /api/admin/kether-docs/sync`
- `GET /api/actions-schema`

管理 API 使用 `Authorization: Bearer <ADMIN_KEY>`。详细插件 WebSocket 协议见 `PLUGIN_API.md`。
