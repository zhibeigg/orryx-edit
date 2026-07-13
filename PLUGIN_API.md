# Orryx Editor 插件端协议（0.4.4）

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

## 1. 注册服务器

```json
{
  "type": "server.register",
  "id": "reg-1",
  "data": {
    "license": "LICENSE_KEY",
    "serverName": "生存服-1",
    "serverId": "survival-1"
  }
}
```

`serverId` 应为安装实例的稳定 ID。旧插件省略时服务会从 `serverName` 派生，但多个同名子服会落入同一 workspace，因此新实现必须发送稳定且唯一的 `serverId`。

响应：

```json
{
  "type": "server.register.result",
  "id": "reg-1",
  "data": {
    "success": true,
    "serverKey": "...",
    "serverId": "survival-1",
    "workspaceId": "sha256..."
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
https://editor.example.com/#token=<token>
```

旧 `?token=` 暂时兼容，但前端会在发起认证请求前清除地址栏凭据。

撤销：

```json
{"type":"token.revoke","id":"token-2","data":{"token":"..."}}
```

## 3. Relay 请求 ID

浏览器原始 ID 不会原样发送给插件。中心服务会生成全局 relay ID；插件响应时必须原样返回收到的 relay ID。中心服务随后恢复浏览器原 ID，并只将响应发送给请求发起者。

插件不得把某个浏览器请求的响应作为广播发送。

## 4. 文件协议与 revision

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
{"type":"file.content","id":"relay-id","data":{"path":"skills/example.yml","content":"..."}}
```

中心服务会向浏览器响应补充 `revision`。

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

中心服务仅在 revision 匹配后转发给插件。冲突时插件不会收到请求，浏览器收到：

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

插件成功响应：

```json
{"type":"file.written","id":"relay-id","data":{"path":"skills/example.yml","success":true}}
```

成功后中心服务递增 revision，并向同 workspace 广播：

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

## 7. 稳定错误码

常见错误：

```text
INVALID_MESSAGE
FRAME_TOO_LARGE
INVALID_LICENSE
LICENSE_DISABLED
LICENSE_EXPIRED
IP_NOT_ALLOWED
INVALID_SERVER_ID
INVALID_TOKEN
TOKEN_ALREADY_EXISTS
NOT_AUTHENTICATED
INVALID_RESUME_TOKEN
SERVER_OFFLINE
INVALID_PATH
MISSING_BASE_REVISION
REVISION_CONFLICT
PLUGIN_ERROR
```

错误消息只用于显示；插件逻辑应依据稳定 `code` 分支。
