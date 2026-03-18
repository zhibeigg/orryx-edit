# Orryx Editor

Orryx 插件的 Web 配置编辑器。通过中心服务器中转，让 MC 服务器管理员在浏览器中实时编辑 Orryx 插件配置。

## 架构

```
玩家浏览器 ←HTTP+WS→ 中心服务器 ←WS→ MC服务器 Orryx 插件
                      (本项目)
```

- 中心服务器托管前端页面 + WebSocket 中转
- 插件端连接中心服务器注册，玩家输入 `/orryx editor` 获取编辑器 URL
- 浏览器打开 URL 自动认证，消息在浏览器和插件端之间透传

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind CSS 4 |
| 编辑器 | Monaco Editor（Kether 语法高亮 + 自动补全） |
| 3D 预览 | Three.js（碰撞箱可视化） |
| 后端 | Kotlin + Ktor 3 + Netty |
| 协议 | WebSocket JSON |

## 功能

- YAML 配置文件编辑（通用编辑器 + 技能可视化编辑器）
- Kether 脚本语法高亮、关键字补全
- 技能时间轴可视化
- 碰撞箱 3D 预览（range / obb / sector）
- 文件树浏览、创建、重命名、删除
- 草稿系统（IndexedDB 自动保存）
- 发布面板（diff 对比 + 单文件撤销）
- 实时日志控制台
- 断线自动重连（指数退避）
- License 管理（时长、IP 绑定、续费）
- 管理后台 `/admin` + 客户自助 `/portal`

## 项目结构

```
orryx-edit/
├── web/                    # 前端 React 应用
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── pages/          # 页面（ConnectPage, EditorPage, AdminPage, PortalPage）
│   │   ├── store/          # Zustand 状态管理
│   │   ├── lib/            # 工具库（WebSocket 客户端、Kether 语法、草稿存储等）
│   │   └── types/          # TypeScript 类型定义
│   └── vite.config.ts
├── server/                 # Ktor 中转服务器
│   └── src/main/kotlin/com/orryx/editor/
│       ├── Application.kt          # 入口
│       ├── license/                 # License 管理
│       ├── plugins/                 # Ktor 插件（路由、WebSocket）
│       ├── protocol/                # 消息协议定义
│       └── relay/                   # 中转核心（SessionRegistry, RelayHandler, ServerEndpoint）
├── PLUGIN_API.md           # 插件端对接文档
└── build.sh                # 一键构建脚本
```

## 开发

前端开发（热更新）：

```bash
cd web
npm install
npm run dev
```

后端运行（IntelliJ 直接运行 `Application.kt`，或命令行）：

```bash
cd server
./gradlew run
```

## 构建部署

一键构建：

```bash
bash build.sh
```

产物为单个 fat jar（约 15MB），包含前端 + 后端 + 所有依赖：

```
server/build/libs/orryx-editor-server-all.jar
```

启动：

```bash
java -jar orryx-editor-server-all.jar
```

环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `9090` |
| `ADMIN_KEY` | 管理后台密码 | `change-me` |
| `DATA_DIR` | 数据目录（存放 licenses.json） | `data` |

生产部署建议用 Nginx 反代 + SSL，参考 [PLUGIN_API.md](PLUGIN_API.md) 中的 Nginx 配置。

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | 编辑器（输入 Token 连接） |
| `/admin` | 管理后台（创建/管理 License） |
| `/portal` | 客户自助（查看 License 信息、解绑 IP） |

## License 流程

1. 管理员在 `/admin` 创建 License，设置时长
2. 将 License 发给用户，用户配置到插件中
3. 插件启动时用 License 连接中心服务器，自动绑定服务器 IP
4. 玩家输入 `/orryx editor` → 插件注册一次性 Token → 返回编辑器 URL
5. 玩家打开 URL 即可使用编辑器

## 插件端对接

详见 [PLUGIN_API.md](PLUGIN_API.md)
