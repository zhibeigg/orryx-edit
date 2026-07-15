# Orryx Editor 部署

## systemd + launcher（支持一键更新与自动回滚）

1. 创建系统用户和目录：

```bash
sudo useradd --system --home /var/lib/orryx-editor --shell /usr/sbin/nologin orryx
sudo install -d -o orryx -g orryx -m 0750 /opt/orryx-editor /var/lib/orryx-editor
```

2. 将发布包中的 JAR、`start.sh` 放入 `/opt/orryx-editor`：

```bash
sudo install -o orryx -g orryx -m 0640 orryx-editor-0.14.22.jar /opt/orryx-editor/orryx-editor.jar
sudo install -o orryx -g orryx -m 0750 start.sh /opt/orryx-editor/start.sh
```

3. 复制环境与 service：

```bash
sudo install -m 0640 deploy/orryx-editor.env.example /etc/orryx-editor.env
sudo install -m 0644 deploy/orryx-editor.service /etc/systemd/system/orryx-editor.service
sudo systemctl daemon-reload
sudo systemctl enable --now orryx-editor
```

`/etc/orryx-editor.env` 必须替换 Admin Key、数据库密码和私有仓库只读 Token。文件权限应保持 `0640`，不得提交真实值。

查看状态：

```bash
systemctl status orryx-editor
journalctl -u orryx-editor -f
curl --fail http://127.0.0.1:9090/health/ready
```

Launcher 更新流程：后端下载到 `UPDATE_STAGING_DIR`，校验 Release manifest 与 SHA-256 后以退出码 42 请求重启；`start.sh` 在旧 JVM 退出后再次校验、备份并切换 JAR。新版本 `/health/ready` 或版本核对失败时自动恢复备份。

## Windows launcher

使用 `start.ps1`，设置与 `.env.example` 相同的环境变量，并确保运行账户对 JAR 和 `DATA_DIR` 有写权限。Windows launcher 使用 `Get-FileHash` 和 `/health/ready` 完成相同的切换与回滚流程。

## Docker Compose

```bash
cp .env.example .env
# 设置 ADMIN_KEY、POSTGRES_PASSWORD 等变量
docker compose up -d --build
docker compose ps
```

容器以非 root 用户运行，根文件系统只读，仅 `/app/data` 和 `/tmp` 可写。`DEPLOYMENT_MODE=container` 时应用不会在容器内替换自身 JAR；更新方式是拉取新镜像并重建：

```bash
docker compose pull
docker compose up -d
```

## 实时 Editor License 策略

实时 Editor relay 使用 Orryx License 识别服务器和取得中心保存的 `serverKey`。License 到期不影响插件注册、一次性 Editor Token 或 Resume 会话；License 不存在、被管理员禁用或连接 IP 不符合绑定规则时仍会拒绝。不要通过清空 `licenses.expires_at` 或批量续期实现开放，否则会同时改变商业认领和 License 管理接口的授权边界。

商业 License 认领、账户/RBAC、AI、云草稿、签名发布和 `/api/license/*` 继续使用各自的有效期规则。数据库 Schema 无需因该策略变更而迁移。

## Kether 文档同步

默认启用 Orryx 官方 stable 文档同步：

```text
KETHER_DOCS_SYNC_ENABLED=true
KETHER_DOCS_SYNC_INTERVAL_HOURS=12
KETHER_DOCS_REQUEST_TIMEOUT_SECONDS=20
KETHER_DOCS_MAX_SCHEMA_BYTES=4194304
```

服务端只连接 `https://zhibeigg.github.io/Orryx/kether/`，不需要 GitHub Token。远端不可用时继续提供 PostgreSQL 中最后一次通过校验的 Schema；数据库无缓存时使用 JAR 内置基线。生产防火墙需要允许访问 `zhibeigg.github.io:443`。

## 账户注册

账户 API 默认关闭。需要开放 `/register` 邮箱注册和 `/portal` 登录时，必须在 Compose 环境中显式启用，并保持 HTTPS Cookie：

```text
ACCOUNTS_ENABLED=true
ACCOUNT_SESSION_TTL_HOURS=168
ACCOUNT_COOKIE_SECURE=true
ACCOUNT_COOKIE_DOMAIN=
```

`ACCOUNT_COOKIE_DOMAIN` 留空时使用当前站点的 host-only Cookie，通常更安全。`docker-compose.yml` 会显式透传这些变量；若未设置 `ACCOUNTS_ENABLED=true`，服务端不会注册 `/api/v2/auth/*` 路由。

公开页面由 SPA fallback 提供：`/` 为插件门户，`/register` 为注册页，`/portal` 为账户控制台，`/connect#token=...` 为一次性服务器连接页。Fragment 不会发送给 Nginx/Ktor；前端读取后会立即清除。旧 `/#token=...` 只在浏览器内迁移到 `/connect#token=...`，`?token=` 会被拒绝，不应写入反向代理兼容规则。

## AI 工作台与私有 Runner

AI 工作台默认关闭。启用时必须同时配置账户、云端草稿、Provider 和私有 Runner：

```text
ACCOUNTS_ENABLED=true
CLOUD_DRAFTS_ENABLED=true
AI_WORKBENCH_ENABLED=true
RUNNER_ENABLED=true
AI_PROVIDER_ID=...
AI_PROVIDER_MODEL=...
AI_PROVIDER_BASE_URL=https://...
AI_PROVIDER_API_KEY=...
RUNNER_ENDPOINT=http://127.0.0.1:9781/v1/run
RUNNER_SHARED_SECRET=...
```

Runner 应以低权限用户运行，只暴露 `generate`、`validate`、`plan`，并将文件系统范围限制在独立沙箱。严禁为 Runner 开放 `materialize`、插件生产目录、服务器命令或通用 Shell。Provider Key 与 Runner Secret 只以环境变量注入，不写入数据库或前端配置。

## V2 签名发布

签名发布默认关闭，必须显式启用 V2 relay、V2 writes 和发布事务，并配置 HTTPS 数据面与 Ed25519 密钥：

```text
ACCOUNTS_ENABLED=true
CLOUD_DRAFTS_ENABLED=true
EDITOR_PROTOCOL_V2_ENABLED=true
EDITOR_V2_WRITES_ENABLED=true
RELEASE_TRANSACTIONS_ENABLED=true
RELEASE_PUBLIC_BASE_URL=https://editor.example.com
RELEASE_SIGNING_PRIVATE_KEY_PKCS8_BASE64=...
RELEASE_SIGNING_PUBLIC_KEY_X509_BASE64=...
```

私钥使用 PKCS#8 DER 的 Base64，公钥使用 X.509 DER 的 Base64。Relay 不读取独立的 key id 环境变量；`keyId` 由代码对 X.509 公钥 DER 计算 SHA-256 得出。插件侧需在自身 `Editor.Release.TrustedKeys` 配置中独立预置该 `keyId` 对应的可信公钥。密钥不完整、URL 非 HTTPS、relay 会话未声明 `release.control.v1`、插件缺少完整发布能力或仍连接 V1 时，服务端仅对具体发布请求 fail-closed；插件注册与实时编辑连接不受影响。

生产应持久化并备份插件 `.editor/transactions/` journal；不要在升级或清理时删除。journal 用于 prepared/committing 事务的恢复、回滚与 `RECOVERY_REQUIRED` 人工处置。

## 支付与钱包

支付宝能力默认关闭。启用前配置应用、公私钥、回调地址和产品价格，并确保异步通知 URL 可从支付宝访问。订单状态由数据库事件和签名通知推进；不得仅依赖浏览器返回页。钱包账本为 append-only，数据库备份与审计策略必须覆盖订单、通知、余额和 ledger 表。

## 反向代理

默认只信任 socket remote address。只有反向代理地址明确列入 `TRUSTED_PROXY_IPS` 后才会解析 Forwarded/X-Forwarded-For。生产 HTTPS 可设置 `HSTS_ENABLED=true`，跨源访问必须通过 `CORS_HOSTS` 精确列出 origin。

## PostgreSQL 备份

应用迁移不会回退到 JSON。升级前应备份 PostgreSQL：

```bash
pg_dump --format=custom --file=orryx-editor.dump orryx_editor
```

旧 `licenses.json` 仅首次导入且不会删除，可保留作为历史迁移依据，但之后的数据只存在 PostgreSQL。
