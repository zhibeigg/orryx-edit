# Orryx Editor 插件端协议（0.10.13）

插件通过 `wss://<editor-host>/ws/server` 连接中心服务。插件端文件 I/O 必须异步执行；Bukkit 状态修改和模块重载必须切回 Bukkit 主线程。

## 通用消息

```json
{
  "type": "message.type",
  "id": "request-id",
  "data": {}
}
```

- `type` 最长 64 字符。
- `id` 最长 128 字符。
- 单帧最大 1 MiB。
- 文件路径必须为相对路径，不允许空段、`.`、`..` 或控制字符。
- 错误统一返回 `type=error`，`data={code,message}`。
- Relay 对浏览器/插件角色、消息方向及 V1/V2 消息类型使用硬 allowlist。未知类型返回 `UNKNOWN_MESSAGE_TYPE`，方向错误返回 `MESSAGE_DIRECTION_NOT_ALLOWED`，消息不会继续转发。
- 机器可读的方向、revision 字段与能力合同位于 `schemas/editor-relay-contract-v2.json`；插件包内携带同名资源，双方测试会拒绝 allowlist 漂移。
- 浏览器请求具有固定 expected response type；插件返回错误响应类型时，插件与对应浏览器请求都会收到 `UNEXPECTED_RESPONSE_TYPE`，不会静默等待超时。

### 协议兼容性

- 未声明 `protocolVersions` 的旧插件固定协商为 `v1`，保留 Long revision 和 relay 侧冲突计数行为。
- 新插件可声明 `protocolVersions: ["v1", "v2"]` 与 `preferredProtocol`。服务端返回唯一的 `negotiatedProtocol`。
- `v2` revision 必须是 64 位小写 SHA-256 字符串；它与 V1 Long revision 状态完全隔离，relay 不递增、不替换插件返回的 SHA。
- 同一 workspace 同时只有一个 authoritative plugin session。每次成功注册产生新的 `sessionEpoch`；旧连接继续发消息会稳定收到 `STALE_PLUGIN_SESSION`。
- 协议 V2 默认不参与协商，确保现有 V1 前端与插件写入流程不受灰度代码影响。设置 `EDITOR_PROTOCOL_V2_ENABLED=true` 后才可协商 V2。
- V2 的文件写入、创建、删除、重命名与 Reload 默认全部关闭；只有同时设置 `EDITOR_PROTOCOL_V2_ENABLED=true` 和 `EDITOR_V2_WRITES_ENABLED=true` 后才会转发。
- `manifest.snapshot` 仍为保留消息；`release.request` 与 `release.result` 已正式启用，但只允许 V2 relay↔plugin 方向，浏览器 WebSocket 永远不能直接发起发布。
- 发布事务由已登录账户通过 `/api/v2/releases` 显式创建；插件只执行签名验证、staging、备份、激活、Readiness 与回滚。

## 1. 注册服务器

```json
{
  "type": "server.register",
  "id": "reg-1",
  "data": {
    "license": "LICENSE_KEY",
    "serverName": "生存服-1",
    "serverId": "survival-1",
    "pluginVersion": "1.2.3",
    "protocolVersions": ["v1", "v2"],
    "preferredProtocol": "v2",
    "capabilities": [
      "protocol.allowlist",
      "revision.sha256",
      "mutation.preconditions",
      "release.transaction.v1",
      "release.signature.ed25519",
      "release.readiness.async",
      "release.recovery.v1",
      "release.http-pull.v1"
    ],
    "connectionNonce": "random-connection-nonce"
  }
}
```

`serverId` 应为安装实例的稳定 ID。旧插件省略时服务会从 `serverName` 派生，但多个同名子服会落入同一 workspace，因此新实现必须发送稳定且唯一的 `serverId`。

`license` 是中心签发的服务器身份凭据，仍为必填字段。实时 Editor relay 不以 License 到期时间作为使用门槛；已过期但仍存在、启用且满足 IP 约束的 License 可以注册服务器、签发一次性 Token 和恢复浏览器会话。不存在、显式禁用或 IP 不匹配仍会拒绝。商业认领、账户权益和 License 管理接口继续按原有效期规则执行。

响应：

```json
{
  "type": "server.register.result",
  "id": "reg-1",
  "data": {
    "success": true,
    "serverKey": "...",
    "serverId": "survival-1",
    "workspaceId": "sha256...",
    "negotiatedProtocol": "v2",
    "sessionEpoch": 42,
    "relayCapabilities": [
      "protocol.allowlist",
      "session.epoch",
      "revision.sha256",
      "release.control.v1"
    ],
    "connectionNonce": "random-connection-nonce"
  }
}
```

中心服务使用 `SHA-256(serverKey + NUL + serverId)` 生成 workspace。同 License 的不同 `serverId` 不共享请求、文件事件、日志或浏览器会话。

## 2. 注册一次性编辑 Token

```json
{
  "type": "token.register",
  "id": "token-1",
  "data": {
    "token": "cryptographically-random-token",
    "playerName": "Steve",
    "expiresIn": 300000
  }
}
```

- Token 长度 8–512，不得含空白或控制字符。
- TTL 范围 1 秒至 10 分钟。
- Token 绑定当前插件 WebSocket 和 workspace。
- 浏览器认证时原子消费；无论成功、过期或插件离线都不能再次使用。

向玩家返回的 URL 必须使用 fragment：

```text
https://editor.example.com/connect#token=<token>
```

前端必须在联网前读取并通过 `history.replaceState` 清除 Fragment。`?token=` 查询参数不再支持；连接页会拒绝该凭据、清理地址栏并要求玩家重新执行 `/orryx edit`。

撤销：

```json
{"type":"token.revoke","id":"token-2","data":{"token":"..."}}
```

## 3. Relay 请求 ID

浏览器原始 ID 不会原样发送给插件。中心服务会生成全局 relay ID；插件响应时必须原样返回收到的 relay ID。中心服务随后恢复浏览器原 ID，并只将响应发送给请求发起者。

插件不得把某个浏览器请求的响应作为广播发送。

## 4. 文件协议与 revision

### V1 / V2 隔离

| 项目 | V1 | V2 |
|---|---|---|
| revision 类型 | JSON Long | 64 位小写 SHA-256 字符串 |
| revision 来源 | relay workspace/path 计数器 | 插件文件内容/状态 |
| 写入转发字段 | `baseRevision` | 浏览器 `baseRevision` 映射为插件 `expectedRevision` |
| 成功写入 | relay 自增并覆盖响应 revision | relay 原样保留插件 revision，不自增、不覆盖 |
| `file.changed` | relay 填入 Long | 必须携带并保留插件 SHA revision |

两套 revision 状态不可互读或转换。V2 中大写 SHA、非 64 位字符串或数字 revision 都会以 `INVALID_REVISION` 拒绝。

### 文件树

```json
{"type":"file.list","id":"relay-id","data":{"path":null}}
```

响应：

```json
{"type":"file.tree","id":"relay-id","data":{"files":[]}}
```

### 读取

```json
{"type":"file.read","id":"relay-id","data":{"path":"skills/example.yml"}}
```

插件响应：

```json
{"type":"file.content","id":"relay-id","data":{"path":"skills/example.yml","content":"...","revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}
```

V1 插件可省略 `revision`，中心服务会向浏览器响应补充 Long revision。V2 插件必须返回 SHA revision，中心服务端到端原样保留。

### 写入

浏览器到中心服务：

```json
{
  "type": "file.write",
  "id": "browser-id",
  "data": {
    "path": "skills/example.yml",
    "content": "...",
    "baseRevision": 4,
    "force": false
  }
}
```

上述数字示例是 V1。V2 浏览器请求使用 SHA 字符串：

```json
{
  "type": "file.write",
  "id": "browser-id",
  "data": {
    "path": "skills/example.yml",
    "content": "...",
    "baseRevision": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "force": false
  }
}
```

启用 Phase 0 V2 写路径后，relay 转发给插件时删除 `baseRevision` 并写入同值的 `expectedRevision`。relay 不在 V2 执行 SHA 冲突比较；插件负责原子校验 `expectedRevision` 并返回新 SHA revision。

V1 中心服务仅在 Long revision 匹配后转发给插件。冲突时插件不会收到请求，浏览器收到：

```json
{
  "type": "error",
  "id": "browser-id",
  "data": {
    "code": "REVISION_CONFLICT",
    "message": "文件版本冲突",
    "currentRevision": 5
  }
}
```

插件成功响应（V2 必须包含新 SHA revision）：

```json
{"type":"file.written","id":"relay-id","data":{"path":"skills/example.yml","success":true,"revision":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}}
```

V1 成功后中心服务递增 Long revision。V2 成功后 relay 使用插件响应中的 SHA revision。两者都会向同 workspace 广播：

```json
{
  "type": "file.changed",
  "id": "",
  "data": {
    "workspaceId": "...",
    "path": "skills/example.yml",
    "revision": 6,
    "browserId": "writer-browser-id"
  }
}
```

`force=true` 只用于用户在冲突对话框中明确确认覆盖，不应成为插件默认行为。

### 其他文件操作

```text
file.create {path,isDirectory} -> file.written
file.delete {path}             -> file.written
file.rename {oldPath,newPath}  -> file.written
```

## 5. Presence 与广播

`presence.update` 在中心服务内部处理，不会转发给插件。浏览器收到：

```json
{
  "type": "presence.updated",
  "id": "",
  "data": {
    "workspaceId": "...",
    "members": [
      {
        "browserId": "...",
        "playerName": "Steve",
        "currentFile": "skills/example.yml",
        "lastActiveAt": 1710000000000
      }
    ]
  }
}
```

只有以下主动消息允许向同 workspace 广播：

- `log.entry`
- `presence.updated`
- `file.changed`

其他带 ID 的插件响应必须匹配有效 relay 请求，否则会被丢弃。

## 6. 重载与线程要求

```json
{"type":"reload","id":"relay-id","data":{"module":"all"}}
```

响应：

```json
{"type":"reload.result","id":"relay-id","data":{"module":"all","success":true}}
```

| 操作 | 线程要求 |
|---|---|
| WebSocket、JSON、文件读取/写入 | 异步线程/协程 |
| Bukkit 配置应用、模块 reload | Bukkit 主线程 |
| 日志推送 | 任意线程，但不得阻塞 Bukkit 主线程 |

禁止从异步回调直接调用 Bukkit 主线程敏感 API。应使用 Bukkit Scheduler 切回主线程。

## 7. V2 签名发布事务

发布控制消息只允许协商为 V2、声明完整发布能力且绑定当前 `serverInstanceId` 的权威插件会话。

### Prepare

Relay 发送 `release.request`，`data.action=prepare`。请求包含：

- `transactionId`、`releaseId`、幂等 `commandId`。
- `canonicalVersion=orryx-release-v1`。
- `canonicalPayloadSha256`、`signingKeyId`、无填充 Base64URL Ed25519 `signature`。
- `expectedManifestRevision`、`targetManifestRevision`、`fileCount`、`totalBytes`。
- 短期 `operationsUrl`、Bearer `transferToken` 和 `transferExpiresAt`。

插件必须：

1. 读取当前 allowlist Manifest 并核对 expected revision。
2. 通过精确 HTTPS URL 下载完整目标 operations 与文件；显式允许时仅接受 localhost HTTP。
3. 校验路径、大小写、符号链接、文件大小、SHA-256、总字节和目标 Manifest。
4. 按冻结 canonical 二进制格式重建 payload，并使用本机 `Editor.Release.TrustedKeys` 中的公钥验签。
5. 将完整目标写入 `.editor/releases/transactions/<transactionId>/stage`，持久化 journal 后返回 `PREPARED`。

传输 Token、URL 和过期时间不进入签名；完整目标文件集合、base/content revision 和大小全部进入签名。远端不能通过协议增加或替换 TrustedKeys。

### Commit 与异步 Readiness

Relay 发送 `action=commit` 和 `readinessDeadline`。插件按 Editor allowlist 顶层项执行：

1. live → backup。
2. stage → live。
3. 每个 checkpoint 后原子持久化 journal。
4. 磁盘交换完成立即返回 `READINESS_PENDING`。
5. 在 Bukkit 主线程调用 `ReloadAPI.reloadWithReport()`。
6. 重算 Manifest；重载报告成功且 revision 等于 target 时主动发送 `release.result(action=status,id="",pluginState=READY)`。

Readiness、文件下载和 journal I/O 不得阻塞 Bukkit 主线程。

### Rollback 与恢复

- `action=rollback` 恢复 backup，并验证恢复后的 Manifest 等于 expected revision。
- 进程启动后异步扫描 journal；`COMMITTING`、`ACTIVATING`、`ROLLING_BACK` 自动继续收敛。
- 无法无歧义判断 live/stage/backup 状态时进入 `RECOVERY_REQUIRED`，不得猜测成功。
- 只能交换 Editor allowlist 文件；`config.yml`、数据库、`.editor` 身份和事务目录永不进入替换集合。

插件结果格式：

```json
{
  "type": "release.result",
  "id": "command-id-or-empty",
  "data": {
    "action": "status",
    "transactionId": "uuid",
    "releaseId": "uuid",
    "commandId": "64-char-sha256",
    "success": true,
    "pluginState": "READY",
    "eventId": "uuid",
    "eventSeq": 4,
    "observedManifestRevision": "...",
    "resultManifestRevision": "..."
  }
}
```

机器可读方向、能力和状态列表以 `schemas/editor-relay-contract-v2.json` 为准。

## 8. 稳定错误码

常见错误：

```text
INVALID_MESSAGE
FRAME_TOO_LARGE
UNKNOWN_MESSAGE_TYPE
MESSAGE_DIRECTION_NOT_ALLOWED
MESSAGE_NOT_SUPPORTED
UNEXPECTED_RESPONSE_TYPE
UNKNOWN_RELAY_REQUEST
INVALID_LICENSE
LICENSE_DISABLED
IP_NOT_ALLOWED
INVALID_SERVER_ID
UNSUPPORTED_PROTOCOL
INVALID_PREFERRED_PROTOCOL
INVALID_CAPABILITIES
INVALID_CONNECTION_NONCE
STALE_PLUGIN_SESSION
INVALID_TOKEN
TOKEN_ALREADY_EXISTS
NOT_AUTHENTICATED
INVALID_RESUME_TOKEN
SERVER_OFFLINE
INVALID_PATH
MISSING_BASE_REVISION
INVALID_REVISION
REVISION_CONFLICT
FEATURE_DISABLED
RELEASE_DISABLED
RELEASE_REQUIRES_V2
MISSING_RELEASE_CAPABILITY
MANIFEST_PRECONDITION_FAILED
UNTRUSTED_SIGNING_KEY
SIGNATURE_INVALID
TARGET_MANIFEST_MISMATCH
READINESS_FAILED
RECOVERY_AMBIGUOUS
PLUGIN_ERROR
```

错误消息只用于显示；插件逻辑应依据稳定 `code` 分支。
