# Orryx Editor - 插件端对接文档

> 本文档面向负责 Bukkit/Spigot 插件端开发的同学。
> 编辑器前端和中转服务器由中心服务器统一托管，插件端只需实现 WebSocket 客户端对接即可。

---

## 1. 架构概览

```
玩家浏览器  ←HTTP+WS(/ws)→  中心服务器  ←WS(/ws/server)→  MC服务器 Orryx 插件
                              (你部署)                        (用户部署)
```

**完整流程：**
1. MC 服务器启动 → Orryx 插件连接中心服务器 `ws://中心服务器/ws/server`，发送 `server.register` 注册
2. 玩家输入 `/orryx editor` → 插件生成一次性 Token → 发送 `token.register` 到中心服务器
3. 插件返回 URL：`https://editor.你的域名/?token=xxx`
4. 玩家打开 URL → 浏览器自动连接中心服务器 → 用 Token 认证 → 中心服务器找到对应插件端
5. 后续所有消息（文件读写、重载等）由中心服务器在浏览器和插件端之间透传

**插件端不需要开放任何端口，不需要部署任何前端资源。**

---

## 2. 插件端需要实现的功能

### 2.1 连接中心服务器

插件启动时（或按需），建立 WebSocket 连接：

```
ws://中心服务器地址:端口/ws/server
```

建议使用 [Java-WebSocket](https://github.com/TooTallNate/Java-WebSocket) 库：

```kotlin
// build.gradle.kts
implementation("org.java-websocket:Java-WebSocket:1.5.7")
```

### 2.2 注册游戏服务器

连接成功后，用 license 注册：

```json
{
  "type": "server.register",
  "id": "reg_1",
  "data": {
    "license": "用户购买时获得的license",
    "serverName": "生存服-1"
  }
}
```

- `license`：用户购买插件时获得的授权码，由中心服务器管理员通过 Admin API 创建
- `serverName`：显示在编辑器顶栏的名称，建议从 `server.properties` 自动读取

响应：
```json
{
  "type": "server.register.result",
  "id": "reg_1",
  "data": { "success": true, "serverKey": "自动分配的唯一ID", "message": "已注册: 生存服-1" }
}
```

插件端可以缓存返回的 `serverKey`，但不是必须的——每次用 license 注册即可。

### 2.3 注册 Token（玩家请求编辑器时）

玩家输入 `/orryx editor` 时，插件生成 Token 并注册到中心服务器：

```json
{
  "type": "token.register",
  "id": "tok_1",
  "data": {
    "token": "a1b2c3d4e5f6",
    "playerName": "Steve",
    "expiresIn": 300000
  }
}
```

- `token`：插件端生成的随机字符串（建议 16 位）
- `playerName`：请求编辑器的玩家名
- `expiresIn`：过期时间（毫秒），建议 5 分钟（300000）

响应：
```json
{
  "type": "token.register.result",
  "id": "tok_1",
  "data": { "success": true, "token": "a1b2c3d4e5f6" }
}
```

注册成功后，插件向玩家发送 URL：
```
https://editor.你的域名/?token=a1b2c3d4e5f6
```

### 2.4 撤销 Token（可选）

```json
{
  "type": "token.revoke",
  "id": "rev_1",
  "data": { "token": "a1b2c3d4e5f6" }
}
```

### 2.5 处理浏览器转发来的消息

玩家打开编辑器后，浏览器发送的所有消息会被中心服务器原样转发给插件端。
插件端需要处理这些消息并返回响应（响应会被中心服务器转发回浏览器）。

需要处理的消息类型见下方第 3 节。

---

## 3. 消息协议（浏览器 ↔ 插件端，经中心服务器透传）

所有消息格式：
```json
{
  "type": "消息类型",
  "id": "请求唯一ID",
  "data": { ... }
}
```

`id` 由浏览器生成，插件端响应时必须原样返回。

### 3.1 认证 `auth`

浏览器认证成功后，中心服务器会将 auth 消息转发给插件端（仅通知，无需响应）：
```json
{ "type": "auth", "id": "req_1", "data": { "token": "a1b2c3d4e5f6" } }
```

插件端可以用这个消息记录"哪个玩家正在使用编辑器"，也可以忽略。

### 3.2 文件列表 `file.list`

请求：
```json
{ "type": "file.list", "id": "req_2", "data": { "path": null } }
```

响应：
```json
{
  "type": "file.tree",
  "id": "req_2",
  "data": {
    "files": [
      {
        "name": "skills",
        "path": "skills",
        "isDirectory": true,
        "children": [
          {
            "name": "剑修",
            "path": "skills/剑修",
            "isDirectory": true,
            "children": [
              { "name": "刹那.yml", "path": "skills/剑修/刹那.yml", "isDirectory": false }
            ]
          }
        ]
      }
    ]
  }
}
```

**要点：** `path` 相对于 Orryx 插件数据目录，用 `/` 分隔。目录排在文件前面。

### 3.3 读取文件 `file.read`

请求：`{ "type": "file.read", "id": "req_3", "data": { "path": "skills/剑修/刹那.yml" } }`

响应：`{ "type": "file.content", "id": "req_3", "data": { "path": "skills/剑修/刹那.yml", "content": "YAML内容..." } }`

### 3.4 写入文件 `file.write`

请求：`{ "type": "file.write", "id": "req_4", "data": { "path": "skills/剑修/刹那.yml", "content": "新内容..." } }`

响应：`{ "type": "file.written", "id": "req_4", "data": { "path": "skills/剑修/刹那.yml", "success": true, "message": "可选描述" } }`

**要点：必须在异步线程执行文件 I/O，不能阻塞 Bukkit 主线程。**

### 3.5 创建文件/文件夹 `file.create`

请求：`{ "type": "file.create", "id": "req_5", "data": { "path": "skills/新技能.yml", "isDirectory": false } }`

响应：`{ "type": "file.written", "id": "req_5", "data": { "path": "skills/新技能.yml", "success": true } }`

### 3.6 删除文件 `file.delete`

请求：`{ "type": "file.delete", "id": "req_6", "data": { "path": "skills/废弃.yml" } }`

响应：`{ "type": "file.written", "id": "req_6", "data": { "path": "skills/废弃.yml", "success": true } }`

### 3.7 重命名/移动 `file.rename`

请求：`{ "type": "file.rename", "id": "req_7", "data": { "oldPath": "skills/旧名.yml", "newPath": "skills/新名.yml" } }`

响应：`{ "type": "file.written", "id": "req_7", "data": { "success": true } }`

### 3.8 重载模块 `reload`

请求：`{ "type": "reload", "id": "req_8", "data": { "module": "skill" } }`

`module` 可选值：`"skill"` | `"job"` | `"status"` | `"controller"` | `"buff"` | `"all"`

响应：`{ "type": "reload.result", "id": "req_8", "data": { "module": "skill", "success": true, "message": "已重载 23 个技能" } }`

**要点：必须在 Bukkit 主线程执行重载。** 用 `Bukkit.getScheduler().runTask()` 切回主线程。

### 3.9 日志订阅 `log.subscribe` / `log.unsubscribe`

订阅：`{ "type": "log.subscribe", "id": "req_9", "data": { "filters": { "keyword": "刹那" } } }`

取消：`{ "type": "log.unsubscribe", "id": "req_10", "data": {} }`

订阅后，插件端主动推送日志：
```json
{ "type": "log.entry", "id": "", "data": { "level": "INFO", "message": "日志内容", "timestamp": 1710000000000, "source": "SkillManager" } }
```

### 3.10 错误响应

任何请求失败时返回：
```json
{ "type": "error", "id": "原始请求id", "data": { "message": "错误描述" } }
```

---

## 4. 消息类型速查表

| 方向 | type | 请求 data | 响应 type | 响应 data |
|------|------|-----------|-----------|-----------|
| 插件→中心 | `server.register` | `{ license, serverName }` | `server.register.result` | `{ success, serverKey?, message? }` |
| 插件→中心 | `token.register` | `{ token, playerName, expiresIn }` | `token.register.result` | `{ success, token }` |
| 插件→中心 | `token.revoke` | `{ token }` | `token.revoke.result` | `{ success }` |
| 浏览器→插件 | `file.list` | `{ path? }` | `file.tree` | `{ files: FileTreeNode[] }` |
| 浏览器→插件 | `file.read` | `{ path }` | `file.content` | `{ path, content }` |
| 浏览器→插件 | `file.write` | `{ path, content }` | `file.written` | `{ path, success, message? }` |
| 浏览器→插件 | `file.create` | `{ path, isDirectory }` | `file.written` | `{ path, success }` |
| 浏览器→插件 | `file.delete` | `{ path }` | `file.written` | `{ path, success }` |
| 浏览器→插件 | `file.rename` | `{ oldPath, newPath }` | `file.written` | `{ success }` |
| 浏览器→插件 | `reload` | `{ module }` | `reload.result` | `{ module, success, message? }` |
| 浏览器→插件 | `log.subscribe` | `{ filters? }` | — | 开始推送 log.entry |
| 浏览器→插件 | `log.unsubscribe` | `{}` | — | 停止推送 |
| 插件→浏览器 | `log.entry` | — | — | `{ level, message, timestamp, source? }` |

---

## 5. 插件端实现参考（Kotlin）

```kotlin
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.net.URI
import java.util.UUID

class OrryxEditorClient(
    private val plugin: OrryxPlugin,
    private val editorUrl: String,      // "wss://editor.你的域名/ws/server"
    private val license: String,        // 用户购买时获得的 license
    private val serverName: String       // 自动从 server.properties 读取
) {
    private var ws: WebSocketClient? = null

    fun connect() {
        ws = object : WebSocketClient(URI(editorUrl)) {
            override fun onOpen(handshake: ServerHandshake) {
                // 注册服务器
                send("""{"type":"server.register","id":"reg","data":{"license":"$license","serverName":"$serverName"}}""")
            }

            override fun onMessage(message: String) {
                val msg = parseJson(message) // 你的 JSON 解析
                when (msg.type) {
                    "server.register.result" -> plugin.logger.info("编辑器服务器注册: ${msg.data}")
                    "token.register.result"  -> { /* token 注册成功 */ }
                    // 浏览器转发来的消息
                    "file.list"   -> handleFileList(msg)
                    "file.read"   -> handleFileRead(msg)
                    "file.write"  -> handleFileWrite(msg)
                    "file.create" -> handleFileCreate(msg)
                    "file.delete" -> handleFileDelete(msg)
                    "file.rename" -> handleFileRename(msg)
                    "reload"      -> handleReload(msg)
                    "log.subscribe"   -> handleLogSubscribe(msg)
                    "log.unsubscribe" -> handleLogUnsubscribe(msg)
                    "auth"        -> { /* 可选：记录谁在使用编辑器 */ }
                }
            }

            override fun onClose(code: Int, reason: String, remote: Boolean) {
                plugin.logger.warning("编辑器连接断开: $reason, 5秒后重连...")
                plugin.server.scheduler.runTaskLaterAsynchronously(plugin, { connect() }, 100L)
            }

            override fun onError(ex: Exception) {
                plugin.logger.severe("编辑器连接错误: ${ex.message}")
            }
        }
        ws?.connect()
    }

    /**
     * 玩家输入 /orryx editor 时调用
     */
    fun generateEditorUrl(playerName: String): String {
        val token = UUID.randomUUID().toString().replace("-", "").take(16)
        ws?.send("""{"type":"token.register","id":"","data":{"token":"$token","playerName":"$playerName","expiresIn":300000}}""")
        return "https://editor.你的域名/?token=$token"
    }

    // ---- 消息处理器（异步线程执行文件 I/O） ----

    private fun handleFileList(msg: WsMessage) {
        plugin.server.scheduler.runTaskAsynchronously(plugin) {
            val tree = buildFileTree(plugin.dataFolder, "")
            ws?.send("""{"type":"file.tree","id":"${msg.id}","data":{"files":${toJson(tree)}}}""")
        }
    }

    private fun handleFileRead(msg: WsMessage) {
        plugin.server.scheduler.runTaskAsynchronously(plugin) {
            val path = msg.data.path
            val file = File(plugin.dataFolder, path)
            // 路径安全检查
            if (!file.canonicalPath.startsWith(plugin.dataFolder.canonicalPath)) {
                ws?.send("""{"type":"error","id":"${msg.id}","data":{"message":"非法路径"}}""")
                return@runTaskAsynchronously
            }
            val content = file.readText(Charsets.UTF_8)
            ws?.send("""{"type":"file.content","id":"${msg.id}","data":{"path":"$path","content":${toJsonString(content)}}}""")
        }
    }

    private fun handleReload(msg: WsMessage) {
        // reload 必须回主线程
        plugin.server.scheduler.runTask(plugin) {
            val module = msg.data.module ?: "all"
            // 调用 Orryx 的 reload API
            val success = orryxReload(module)
            ws?.send("""{"type":"reload.result","id":"${msg.id}","data":{"module":"$module","success":$success}}""")
        }
    }

    // ... 其他处理器类似
}
```

### 命令注册

```kotlin
// /orryx editor
fun onEditorCommand(sender: Player) {
    val url = editorClient.generateEditorUrl(sender.name)
    sender.sendMessage("§a§l[Orryx] §f点击打开编辑器:")
    // 发送可点击的 URL（使用 Adventure 或 Spigot API）
    sender.spigot().sendMessage(
        TextComponent(url).apply {
            color = ChatColor.AQUA
            isUnderlined = true
            clickEvent = ClickEvent(ClickEvent.Action.OPEN_URL, url)
            hoverEvent = HoverEvent(HoverEvent.Action.SHOW_TEXT, Text("点击打开 Orryx 编辑器"))
        }
    )
}
```

---

## 6. 线程安全注意事项

| 操作 | 线程要求 |
|------|----------|
| WebSocket 连接/重连 | **异步线程** |
| 文件读写 (file.read/write/create/delete/rename) | **异步线程** |
| 模块重载 (reload) | **Bukkit 主线程** |
| 日志推送 (log.entry) | 任意线程 |
| Token 生成 (/orryx editor) | 主线程（命令处理） |

---

## 7. 配置建议

插件端无需用户配置。以下信息硬编码在插件代码中：

```kotlin
// 硬编码在插件代码中，用户无需配置
private const val EDITOR_URL = "wss://editor.你的域名/ws/server"
```

用户唯一需要的是购买时获得的 license，插件首次启动时自动读取并注册。
建议将 license 存储在 `plugins/Orryx/license.key` 文件中（首次启动时提示用户输入）。

---

## 8. 中心服务器部署

中心服务器是一个单 jar 文件，需要 Java 21+：

```bash
java -jar orryx-editor-server-all.jar
```

环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `9090` |
| `ADMIN_KEY` | 管理 API 密钥 | `change-me` |
| `DATA_DIR` | 数据目录（存放 licenses.json） | `data` |

部署示例：
```bash
PORT=9090 ADMIN_KEY=myAdminSecret java -jar orryx-editor-server-all.jar
```

### License 管理 API

创建 license（分发给用户）：
```bash
curl -X POST https://editor.你的域名/api/admin/license \
  -H "Authorization: Bearer myAdminSecret" \
  -H "Content-Type: application/json" \
  -d '{"owner":"用户名"}'
# 返回: {"license":"a1b2c3d4e5f6g7h8i9j0","serverKey":"...","owner":"用户名"}
```

列出所有 license：
```bash
curl https://editor.你的域名/api/admin/licenses \
  -H "Authorization: Bearer myAdminSecret"
```

禁用 license：
```bash
curl -X DELETE https://editor.你的域名/api/admin/license/a1b2c3d4e5f6g7h8i9j0 \
  -H "Authorization: Bearer myAdminSecret"
```

建议用 Nginx 反代并配置 SSL：
```nginx
server {
    listen 443 ssl;
    server_name editor.你的域名;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 9. 扩展预留

| type | 说明 | 状态 |
|------|------|------|
| `player.list` | 获取在线玩家列表 | 预留 |
| `player.info` | 获取玩家详细信息 | 预留 |
| `skill.test` | 让指定玩家测试释放技能 | 预留 |
| `skill.validate` | 校验 Kether 脚本语法 | 预留 |
| `backup.create` | 创建配置备份 | 预留 |
| `backup.restore` | 恢复配置备份 | 预留 |

扩展新消息类型时，中心服务器会原样透传，无需修改中心服务器代码。
