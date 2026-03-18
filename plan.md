# Orryx 技能编辑器网站 — 实现计划

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **UI 组件**: Tailwind CSS 4 + shadcn/ui
- **状态管理**: Zustand
- **YAML 处理**: js-yaml（解析/序列化技能配置）
- **代码编辑器**: Monaco Editor（用于 Kether 脚本和 YAML 编辑）

## 核心功能

### 1. 技能可视化编辑器
- 表单化编辑技能的所有 Options 字段（Name、Type、Sort、Icon、MinLevel、MaxLevel 等）
- 根据技能类型（DIRECT / DIRECT AIM / PASSIVE / PRESSING / PRESSING AIM）动态显示/隐藏对应字段
  - DIRECT AIM: 显示 AimRadiusAction、AimSizeAction
  - PRESSING: 显示 Period、PressPeriodAction、MaxPressTickAction
  - PRESSING AIM: 显示以上两组
  - PASSIVE: 隐藏 Actions、CastCheckAction 等
- Variables 编辑器：键值对表格，支持添加/删除/编辑，值支持纯数字或 Kether calc 表达式
- Description 列表编辑器：支持拖拽排序、添加/删除行、`{{ }}` 模板语法高亮

### 2. Kether 脚本编辑器
- 基于 Monaco Editor 的 Actions / ExtendActions 编辑
- 语法高亮（自定义 Kether 语言定义）
- 常用动作的自动补全提示（damage、launch、flash、sleep、dragon、entity 等）
- 常用选择器的补全（@self、@range、@obb、@sector 等）

### 3. YAML 导入/导出
- 导入：上传或粘贴 YAML 文件，解析为编辑器表单
- 导出：将编辑器内容序列化为标准 YAML 格式
- 实时预览：左侧表单编辑，右侧实时显示生成的 YAML
- 支持批量导入整个 skills 目录

### 4. 技能管理
- 技能列表视图（按职业分组）
- 创建新技能（可选择模板）
- 复制/删除技能
- 搜索和筛选

### 5. 项目/工作区
- 本地存储（localStorage/IndexedDB）保存编辑状态
- 导出为 zip 包（保持目录结构）

## 页面结构

```
/                    → 首页/技能列表
/editor/:skillKey    → 技能编辑器（主页面）
/import              → 批量导入
```

## 项目结构

```
orryx-edit/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── types/
│   │   └── skill.ts              # 技能数据类型定义
│   ├── store/
│   │   └── skill-store.ts        # Zustand 状态管理
│   ├── lib/
│   │   ├── yaml-parser.ts        # YAML 解析/序列化
│   │   └── kether-language.ts    # Monaco Kether 语言定义
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── skill-list/
│   │   │   ├── SkillList.tsx
│   │   │   └── SkillCard.tsx
│   │   ├── editor/
│   │   │   ├── SkillEditor.tsx       # 主编辑器容器
│   │   │   ├── OptionsPanel.tsx      # Options 表单面板
│   │   │   ├── VariablesEditor.tsx   # Variables 键值对编辑
│   │   │   ├── DescriptionEditor.tsx # Description 列表编辑
│   │   │   ├── ActionsEditor.tsx     # Kether 脚本编辑器
│   │   │   └── YamlPreview.tsx       # YAML 实时预览
│   │   └── ui/                       # shadcn/ui 组件
│   └── pages/
│       ├── HomePage.tsx
│       ├── EditorPage.tsx
│       └── ImportPage.tsx
```

## 实现步骤

### Phase 1: 项目初始化
1. 初始化 Vite + React + TypeScript 项目
2. 安装依赖：tailwindcss、zustand、js-yaml、@monaco-editor/react、react-router-dom、lucide-react
3. 配置 Tailwind CSS 4 和基础样式（暗色主题为主）

### Phase 2: 数据层
4. 定义 TypeScript 类型（ISkill、ICastSkill、SkillType 等）
5. 实现 YAML 解析器（YAML ↔ 技能对象双向转换）
6. 实现 Zustand store（技能列表 CRUD、当前编辑技能状态）

### Phase 3: 编辑器核心
7. 实现 OptionsPanel（表单字段，按类型动态显示）
8. 实现 VariablesEditor（键值对表格）
9. 实现 DescriptionEditor（列表编辑）
10. 实现 ActionsEditor（Monaco + Kether 语法高亮）
11. 实现 YamlPreview（实时 YAML 输出）
12. 组装 SkillEditor 主容器

### Phase 4: 页面和导航
13. 实现 SkillList 和 SkillCard
14. 实现页面路由
15. 实现导入/导出功能

### Phase 5: 打磨
16. 响应式布局
17. 键盘快捷键
18. 错误处理和验证提示
