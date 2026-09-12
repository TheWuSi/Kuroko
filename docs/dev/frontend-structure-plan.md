# 前端目录优化分 Batch 计划

## 目标与基线

- 基线提交：`33a7145`，制定日期：2026-09-07。
- 当前前端已经接入 Axios、Zustand 和 shadcn/ui，但六个业务页面、请求及重复组件仍集中在 774 行的 `App.tsx` 中，页面依靠状态切换。
- 已确认采用 React Router v7 声明式路由，继续使用 Axios 和 React hooks；保留 React 19、TypeScript、Vite、Tailwind CSS v4、Zustand 与 pnpm。
- 保持现有业务功能和视觉布局，不扩展业务 CRUD，不接入 TanStack Query，不修改后端接口或数据库。
- 基线验证：构建、格式检查通过；lint 有两条现存 Fast Refresh 警告，分别来自 Shell 导航常量和 Button 样式导出。

## 目标目录与职责

```text
frontend/src/
├── main.tsx
├── App.tsx                  # 应用入口与路由装配
├── routes/                  # 路由、导航元数据、认证守卫
├── pages/                   # 六个业务页面及登录、初始化、404 页面
├── hooks/                   # 认证、业务请求及轮询逻辑
├── api/                     # Axios 客户端与领域请求函数
├── components/
│   ├── ui/                  # shadcn/ui 基础组件
│   ├── layout/              # Shell 应用布局
│   └── common/              # Panel、Notice、TaskRow、AuthForm 等复用组件
├── stores/                  # Zustand 会话与全局界面状态
├── types/                   # API 与领域类型
├── lib/                     # cn、格式化等工具
├── assets/
└── index.css
```

页面负责组合、表单输入和展示；hooks 管理请求生命周期、数据及操作状态；api 负责 HTTP 调用。Zustand 保留会话和全局错误提示，URL 管理页面位置，业务查询数据留在 hooks。跨目录使用已有 `@/` 别名，不增加统一导出层或通用请求框架。

后端继续使用 `/api/v1` 与原有响应协议；前端补齐调用类型、取消信号透传和取消错误识别。

## Batch 执行安排

### Batch 1：页面与组件拆分

状态：已完成。

- 将六个业务页面移入 pages，暂时保留状态切页。
- 接通已有 Shell、AuthForm、展示组件、类型和工具，删除入口中的重复实现。
- 项目复用组件移入 components/common，ui 仅保留基础组件。
- 为 frontend/src/lib 增加精确的 Git 忽略例外，避免新增工具文件漏跟踪。
- 验收：页面行为与布局保持一致，入口不再承载业务页面，lint、格式检查、构建通过。

### Batch 2：领域 API 与 hooks

状态：已完成，依赖 Batch 1。

- 补齐磁力、任务、番号、存储、配置领域 API；提取认证初始化和页面数据 hooks。
- 复用领域类型并补齐分页、提交入参和操作回执，清除迁移代码中的 any。
- 保持任务首次加载、每 10 秒轮询和手动刷新；避免请求重叠，卸载时取消请求并清理定时器。
- 搜索只采用最新结果；取消不提示失败，认证检查网络错误提供重试。
- 引入最小 Vitest、Testing Library、jsdom 测试配置，验证竞态和生命周期清理。
- 验收：页面不直接调用 HTTP，关键 hooks 测试通过，业务列表不进入 Zustand。

### Batch 3：URL 路由与认证守卫

状态：已完成，依赖 Batch 2。

- 使用 react-router v7 与 BrowserRouter；`/` 跳转 `/dashboard`。
- 认证地址为 `/login`、`/bootstrap`；受保护业务地址为 `/dashboard`、`/magnets`、`/tasks`、`/codes`、`/storages`、`/settings`；未知地址显示 404。
- 导航和标题共用元数据；Shell 使用 NavLink 与 Outlet，删除 UI store 中的 page/setPage。
- 初始化只运行一份。认证未确定时显示加载或重试界面；未初始化进入初始化页，未登录进入登录页；登录后返回原有效站内页面。
- 401 和退出同步清理当前会话与本地 Token；显式新 Token 优先，旧请求不得恢复旧会话或清除新会话。
- 页面地址变化时清理旧错误提示；Vite `/api` 代理至本地 8000，生产复用 FastAPI SPA 回退。
- 验收：直达、刷新、前进后退、高亮和认证守卫测试通过。

### Batch 4：回归与文档收尾

状态：进行中，依赖 Batch 3。

- 用 API mock 回归解析、下载提交、任务刷新、搜索、扫描触发、存储展示和配置保存。
- 核对桌面与移动端布局；验证生产深链刷新以及 API、文档路由边界。
- 更新 README 和架构目录说明，明确 TanStack Query 尚未接入；记录各 Batch 结果和遗留问题。
- 验收：检查与关键测试通过，文档与代码一致。

## 验证约定

每批运行 `pnpm --dir frontend lint`、`pnpm --dir frontend format:check`、`pnpm --dir frontend build`；Batch 2 起运行 `pnpm --dir frontend test`。

测试重点为认证等待与重试、页面直达、401 会话清理、过期请求、搜索竞态，以及 StrictMode 下的轮询清理。仅对关键行为增加自动化测试，不为文件移动增加快照测试。

## 执行记录

- 开始实施：已复核工作区干净，基线与计划一致。
- Batch 1：已拆出六个页面并复用现有组件；lint、格式检查与生产构建通过，仍为基线两条 lint 警告。
- Batch 2：领域 API 与 hooks 已接通，13 项测试通过；构建与格式检查通过，lint 保持基线两条警告。认证和 Axios 会话版本保护随请求封装一并落地。
- Batch 3：六个 URL 路由、认证守卫、初始化与登录返回已接通，30 项测试通过；构建与格式检查通过，lint 已无警告。
