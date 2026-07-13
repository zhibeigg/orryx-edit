# Orryx Editor 部署

## systemd + launcher（支持一键更新与自动回滚）

1. 创建系统用户和目录：

```bash
sudo useradd --system --home /var/lib/orryx-editor --shell /usr/sbin/nologin orryx
sudo install -d -o orryx -g orryx -m 0750 /opt/orryx-editor /var/lib/orryx-editor
```

2. 将发布包中的 JAR、`start.sh` 放入 `/opt/orryx-editor`：

```bash
sudo install -o orryx -g orryx -m 0640 orryx-editor-0.4.3.jar /opt/orryx-editor/orryx-editor.jar
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

## Kether 文档同步

默认启用 Orryx 官方 stable 文档同步：

```text
KETHER_DOCS_SYNC_ENABLED=true
KETHER_DOCS_SYNC_INTERVAL_HOURS=12
KETHER_DOCS_REQUEST_TIMEOUT_SECONDS=20
KETHER_DOCS_MAX_SCHEMA_BYTES=4194304
```

服务端只连接 `https://zhibeigg.github.io/Orryx/kether/`，不需要 GitHub Token。远端不可用时继续提供 PostgreSQL 中最后一次通过校验的 Schema；数据库无缓存时使用 JAR 内置基线。生产防火墙需要允许访问 `zhibeigg.github.io:443`。

## 反向代理

默认只信任 socket remote address。只有反向代理地址明确列入 `TRUSTED_PROXY_IPS` 后才会解析 Forwarded/X-Forwarded-For。生产 HTTPS 可设置 `HSTS_ENABLED=true`，跨源访问必须通过 `CORS_HOSTS` 精确列出 origin。

## PostgreSQL 备份

应用迁移不会回退到 JSON。升级前应备份 PostgreSQL：

```bash
pg_dump --format=custom --file=orryx-editor.dump orryx_editor
```

旧 `licenses.json` 仅首次导入且不会删除，可保留作为历史迁移依据，但之后的数据只存在 PostgreSQL。
