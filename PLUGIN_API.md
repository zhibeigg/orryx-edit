# Orryx Editor - 插件端 WebSocket 对接文档

> 本文档面向负责 Bukkit/Spigot 插件端开发的同学。  
> 前端 + 中转服务器已就绪，插件端只需实现 WebSocket 服务端并按本协议响应消息即可。

---

## 1. 架构概览

```
浏览器 (React)  ←WebSocket→  中转服务器 (Ktor)  ←WebSocket→  游戏服务器 (Bukkit 插件)
```

- **中转服务器**：已实现，负责静态资源托管 + 消息转发。当前内置 Mock 模式可独立运行。
- **插件端**：需要实现一个 WebSocket **服务端**（或客户端连接到中转服务器），处理下文定义的消息协议。

### 部署模式

| 模式 | 说明 |
|------|------|
| Mock 模式 | 中转服务器直接读写本地 `Orryx/` 目录，无需插件端。用于前端开发调试。 |
| 直连模式 | 前端直接连接插件端 WebSocket（插件内嵌 WebSocket 服务端）。 |
| 中转模式 | 前端 → 中转服务器 → 插件端。中转服务器负责 Token 校验和消息转发。 |

推荐使用**直连模式**，插件端内嵌轻量 WebSocket 服务端（如 Java-WebSocket 库）。

---

## 2. 消息格式

所有消息均为 JSON，统一格式：

```json
{
  "type": "消息类型",
  "id": "请求唯一ID",
  "data": { ... }
}
```

- `type`：消息类型字符串，见下方完整列表
- `id`：请求方生成的唯一 ID，响应时必须原样返回，用于前端匹配请求-响应对
- `data`：消息体，不同类型结构不同

---

## 3. 插件端需要实现的消息处理器

### 3.1 认证 `auth`

前端发送：
```json
{
  "type": "auth",
  "id": "req_1_1710000000000",
  "data": { "token": "一次性Token" }
}
```

插件端响应：
```json
{
  "type": "auth.result",
  "id": "req_1_1710000000000",
  "data": {
    "success": true,
    "serverName": "生存服-1",
    "permissions": ["*"]
  }
}
```

**实现要点：**
- Token 由插件端生成（建议通过游戏内命令 `/orryx editor token`），一次性使用，建议 5 分钟过期
- `permissions` 预留字段，当前前端未做权限校验，可返回 `["*"]`
- 认证失败时必须返回 `"success": false`，前端会断开连接并提示用户
- 前端支持断线自动重连（指数退避，最多 10 次），重连后会自动重新发送 `auth` 消息

---

### 3.2 文件列表 `file.list`

前端发送：
```json
{
  "type": "file.list",
  "id": "req_2",
  "data": { "path": null }
}
```

插件端响应：
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
              {
                "name": "刹那.yml",
                "path": "skills/剑修/刹那.yml",
                "isDirectory": false
              }
            ]
          }
        ]
      },
      {
        "name": "config.yml",
        "path": "config.yml",
        "isDirectory": false
      }
    ]
  }
}
```

**实现要点：**
- `path` 为相对于 Orryx 插件数据目录的路径，使用 `/` 分隔
- 递归返回完整文件树，目录排在文件前面
- 文件节点不需要 `children` 字段

---

### 3.3 读取文件 `file.read`

前端发送：
```json
{
  "type": "file.read",
  "id": "req_3",
  "data": { "path": "skills/剑修/刹那.yml" }
}
```

插件端响应：
```json
{
  "type": "file.content",
  "id": "req_3",
  "data": {
    "path": "skills/剑修/刹那.yml",
    "content": "Options:\n  Type: \"DIRECT\"\n  Name: \"刹那\"\n..."
  }
}
```

**实现要点：**
- 返回文件的原始 UTF-8 文本内容
- 必须做路径安全检查，防止 `../` 路径遍历

---

### 3.4 写入文件 `file.write`

前端发送：
```json
{
  "type": "file.write",
  "id": "req_4",
  "data": {
    "path": "skills/剑修/刹那.yml",
    "content": "Options:\n  Type: \"DIRECT\"\n  Name: \"刹那\"\n..."
  }
}
```

插件端响应：
```json
{
  "type": "file.written",
  "id": "req_4",
  "data": {
    "path": "skills/剑修/刹那.yml",
    "success": true,
    "message": "可选的结果描述"
  }
}
```

**实现要点：**
- **必须在异步线程执行文件 I/O**，不能阻塞主线程
- 写入前自动创建父目录
- 写入后不自动重载，等待前端显式发送 `reload`
- `message` 字段可选，用于返回额外信息（如写入字节数、备份路径等）

---

### 3.5 创建文件/文件夹 `file.create`

前端发送：
```json
{
  "type": "file.create",
  "id": "req_5",
  "data": {
    "path": "skills/新职业/新技能.yml",
    "isDirectory": false
  }
}
```

插件端响应：
```json
{
  "type": "file.written",
  "id": "req_5",
  "data": {
    "path": "skills/新职业/新技能.yml",
    "success": true
  }
}
```

---

### 3.6 删除文件 `file.delete`

前端发送：
```json
{
  "type": "file.delete",
  "id": "req_6",
  "data": { "path": "skills/剑修/废弃技能.yml" }
}
```

插件端响应：
```json
{
  "type": "file.written",
  "id": "req_6",
  "data": {
    "path": "skills/剑修/废弃技能.yml",
    "success": true
  }
}
```

**实现要点：**
- 如果是目录，递归删除
- 删除前建议做备份（可选）

---

### 3.7 重命名/移动文件 `file.rename`

前端发送：
```json
{
  "type": "file.rename",
  "id": "req_7",
  "data": {
    "oldPath": "skills/剑修/旧名.yml",
    "newPath": "skills/剑修/新名.yml"
  }
}
```

插件端响应：
```json
{
  "type": "file.written",
  "id": "req_7",
  "data": { "success": true }
}
```

---

### 3.8 重载模块 `reload`

前端发送：
```json
{
  "type": "reload",
  "id": "req_8",
  "data": { "module": "skill" }
}
```

`module` 可选值：`"skill"` | `"job"` | `"status"` | `"controller"` | `"buff"` | `"all"`

插件端响应：
```json
{
  "type": "reload.result",
  "id": "req_8",
  "data": {
    "module": "skill",
    "success": true,
    "message": "已重载 23 个技能配置"
  }
}
```

**实现要点：**
- **必须在 Bukkit 主线程执行重载逻辑**（调用 Orryx 的 reload API）
- 使用 `Bukkit.getScheduler().runTask()` 切回主线程
- `message` 可包含重载结果摘要

---

### 3.9 日志订阅 `log.subscribe` / `log.unsubscribe`

前端发送：
```json
{
  "type": "log.subscribe",
  "id": "req_9",
  "data": {
    "filters": {
      "level": "WARN",
      "source": "SkillManager",
      "keyword": "刹那"
    }
  }
}
```

订阅后，插件端主动推送日志：
```json
{
  "type": "log.entry",
  "id": "",
  "data": {
    "level": "INFO",
    "message": "[SkillManager] 玩家 Steve 释放技能: 刹那",
    "timestamp": 1710000000000,
    "source": "SkillManager"
  }
}
```

取消订阅：
```json
{
  "type": "log.unsubscribe",
  "id": "req_10",
  "data": {}
}
```

**实现要点：**
- `log.entry` 是服务端主动推送，`id` 可为空字符串
- `level` 可选值：`"INFO"` | `"WARN"` | `"ERROR"` | `"DEBUG"`
- `timestamp` 为毫秒级 Unix 时间戳
- `filters` 中的字段均为可选，插件端按需过滤
- 建议限制推送频率，避免高频日志淹没 WebSocket

---

### 3.10 服务器信息 `server.info`（服务端主动推送）

插件端可定期推送服务器状态：
```json
{
  "type": "server.info",
  "id": "",
  "data": {
    "name": "生存服-1",
    "version": "Orryx 2.1.0",
    "players": 42
  }
}
```

前端会在顶栏显示服务器名称和在线人数。

---

### 3.11 错误响应 `error`

任何请求处理失败时返回：
```json
{
  "type": "error",
  "id": "原始请求的id",
  "data": {
    "message": "错误描述"
  }
}
```

---

## 4. 消息类型速查表

| 方向 | type | 请求 data | 响应 type | 响应 data |
|------|------|-----------|-----------|-----------|
| → | `auth` | `{ token }` | `auth.result` | `{ success, serverName?, permissions? }` |
| → | `file.list` | `{ path? }` | `file.tree` | `{ files: FileTreeNode[] }` |
| → | `file.read` | `{ path }` | `file.content` | `{ path, content }` |
| → | `file.write` | `{ path, content }` | `file.written` | `{ path, success, message? }` |
| → | `file.create` | `{ path, isDirectory }` | `file.written` | `{ path, success, message? }` |
| → | `file.delete` | `{ path }` | `file.written` | `{ path, success, message? }` |
| → | `file.rename` | `{ oldPath, newPath }` | `file.written` | `{ success }` |
| → | `reload` | `{ module }` | `reload.result` | `{ module, success, message? }` |
| → | `log.subscribe` | `{ filters? }` | — | 开始推送 `log.entry` |
| → | `log.unsubscribe` | `{}` | — | 停止推送 |
| ← | `log.entry` | — | — | `{ level, message, timestamp, source? }` |
| ← | `server.info` | — | — | `{ name, version, players }` |
| ← | `error` | — | — | `{ message }` |

---

## 5. 插件端实现参考（Kotlin 伪代码）

```kotlin
// build.gradle.kts 添加依赖
// implementation("org.java-websocket:Java-WebSocket:1.5.7")

class OrryxEditorServer(port: Int, private val plugin: OrryxPlugin) : WebSocketServer(InetSocketAddress(port)) {

    private val json = Json { ignoreUnknownKeys = true }
    private val logSubscribers = ConcurrentHashMap.newKeySet<WebSocket>()

    override fun onMessage(conn: WebSocket, message: String) {
        val msg = json.decodeFromString<WsMessage>(message)

        // 异步处理文件 I/O
        plugin.server.scheduler.runTaskAsynchronously(plugin) {
            val response = when (msg.type) {
                "auth"           -> handleAuth(msg)
                "file.list"      -> handleFileList(msg)
                "file.read"      -> handleFileRead(msg)
                "file.write"     -> handleFileWrite(msg)
                "file.create"    -> handleFileCreate(msg)
                "file.delete"    -> handleFileDelete(msg)
                "file.rename"    -> handleFileRename(msg)
                "reload"         -> {
                    // reload 必须回主线程
                    val result = CompletableFuture<WsMessage>()
                    plugin.server.scheduler.runTask(plugin) {
                        result.complete(handleReload(msg))
                    }
                    result.get()
                }
                "log.subscribe"  -> { logSubscribers.add(conn); return@runTaskAsynchronously }
                "log.unsubscribe"-> { logSubscribers.remove(conn); return@runTaskAsynchronously }
                else             -> errorResponse(msg.id, "未知消息类型: ${msg.type}")
            }
            conn.send(json.encodeToString(response))
        }
    }

    /** 广播日志给所有订阅者 */
    fun broadcastLog(level: String, message: String, source: String? = null) {
        val entry = buildJsonObject {
            put("level", level)
            put("message", message)
            put("timestamp", System.currentTimeMillis())
            source?.let { put("source", it) }
        }
        val msg = WsMessage("log.entry", "", entry)
        val text = json.encodeToString(msg)
        logSubscribers.forEach { it.send(text) }
    }

    private fun handleFileList(msg: WsMessage): WsMessage {
        val dataDir = plugin.dataFolder  // Orryx 插件数据目录
        val tree = buildFileTree(dataDir, "")
        return WsMessage("file.tree", msg.id, buildJsonObject {
            putJsonArray("files") { tree.forEach { add(it) } }
        })
    }

    // ... 其他处理器参照 Mock 实现
}
```

---

## 6. Token 生成建议

```kotlin
// 游戏内命令: /orryx editor token
@CommandHandler
fun onEditorToken(sender: Player) {
    val token = UUID.randomUUID().toString().replace("-", "").take(16)
    tokenStore[token] = TokenInfo(
        player = sender.uniqueId,
        createdAt = System.currentTimeMillis(),
        expiresAt = System.currentTimeMillis() + 300_000  // 5 分钟过期
    )
    sender.sendMessage("§a编辑器 Token: §f$token")
    sender.sendMessage("§7在浏览器中输入此 Token 连接编辑器")
    sender.sendMessage("§7或直接访问: http://服务器IP:9090/?token=$token")
}
```

---

## 7. 线程安全注意事项

| 操作 | 线程要求 |
|------|----------|
| 文件读写 (file.read/write/create/delete/rename) | **异步线程**（不能阻塞主线程） |
| 模块重载 (reload) | **主线程**（Bukkit API 要求） |
| 日志推送 (log.entry) | 任意线程 |
| WebSocket 消息收发 | WebSocket 库自己的线程 |

---

## 8. 前端连接参数

前端通过 URL 参数或输入框传递 Token：

```
http://服务器IP:9090/?token=abc123def456
```

WebSocket 连接地址：
```
ws://服务器IP:9090/ws        # 通过中转服务器
ws://服务器IP:端口/           # 直连插件端
```

前端 `.env` 配置：
```
VITE_WS_URL=ws://localhost:9090/ws
```

---

## 9. 文件路径约定

所有 `path` 字段均为相对于 Orryx 插件数据目录的路径：

```
skills/剑修/刹那.yml          ← 技能配置（启用可视化编辑器）
jobs/剑修.yml                 ← 职业配置
controllers/长剑.yml          ← 控制器配置
status/剑修.yml               ← 状态配置
stations/击中.yml             ← 站点配置
experiences/default.yml       ← 经验配置
placeholders/example.yml      ← 占位符配置
ui/dragoncore/setting.yml     ← UI 配置
lang/zh_CN.yml                ← 语言文件
buffs.yml                     ← Buff 配置
config.yml                    ← 主配置
datasource.yml                ← 数据源配置
kether.yml                    ← Kether 配置
```

前端根据路径前缀自动识别配置类型，技能文件（`skills/` 下）会启用可视化编辑器。

---

## 10. 前端行为说明

插件端开发时需要了解的前端行为：

### 草稿系统
- 前端编辑器修改内容后不会立即发送 `file.write`，而是先保存为本地草稿（IndexedDB）
- 用户点击"发布"按钮或按 `Ctrl+S` 时才会发送 `file.write`
- 断线期间用户仍可编辑，草稿自动保存到本地，重连后可发布

### 断线重连
- WebSocket 断开后，前端自动尝试重连（指数退避：1s → 2s → 4s → ... → 30s，最多 10 次）
- 重连成功后自动重新发送 `auth` 消息（使用首次认证的 token）
- 如果 token 已过期导致重连认证失败，前端会提示用户重新输入 token
- 插件端应支持同一 token 的多次认证（重连场景），或在 token 过期后返回 `success: false`

### 发布流程
1. 用户编辑文件 → 草稿保存到本地
2. 用户点击"发布" → 前端逐个发送 `file.write`
3. 用户点击"发布并重载" → 发送所有 `file.write` 后再发送 `reload`
4. 前端会在发布面板显示每个文件的发布结果

### 日志订阅
- 前端在底部面板点击"订阅日志"时发送 `log.subscribe`
- 断线后前端自动重置订阅状态，重连后不会自动重新订阅
- 插件端应在 WebSocket 连接关闭时清理该连接的订阅

---

## 11. 扩展预留

以下消息类型已在协议中预留，插件端可按需实现：

| type | 说明 | 状态 |
|------|------|------|
| `player.list` | 获取在线玩家列表 | 预留 |
| `player.info` | 获取玩家详细信息（职业/等级/技能） | 预留 |
| `skill.test` | 让指定玩家测试释放技能 | 预留 |
| `skill.validate` | 校验 Kether 脚本语法 | 预留 |
| `config.schema` | 获取配置文件的 JSON Schema | 预留 |
| `backup.create` | 创建配置备份 | 预留 |
| `backup.restore` | 恢复配置备份 | 预留 |

扩展新消息类型时，前端 `ws-client.ts` 的 `request()` 和 `on()` 方法支持任意 type 字符串，无需修改前端代码即可通信。
