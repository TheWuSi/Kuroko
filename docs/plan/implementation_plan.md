# 前端重构：原生 shadcn 组件 + 亮暗主题 + 版本号同步

## 背景

当前前端的 `components/ui/` 下有 18 个组件，大部分已经是手动仿写的 shadcn 风格，但存在以下问题：
1. **硬编码颜色** — 组件内大量使用 `text-slate-900`、`bg-blue-600`、`border-slate-200` 等直接色值，而非 shadcn 语义 token（`bg-card`、`text-foreground`、`border-border`），导致无法适配暗色主题
2. **自定义 variant** — `Badge`（`info`/`success`/`warning`）、`Button`（`success`/`mobileTouch`）、`Progress`（`indicatorClassName`）等在标准 shadcn 中不存在
3. **原生 HTML `<select>`** — 多处（Settings、MagnetParser、Codes、Storages）使用 `<select>` 替代 shadcn `Select` 组件
4. **原生 `<input type="radio">`、`<input type="checkbox">`** — MagnetParser、Storages 中未使用 shadcn `RadioGroup`、`Checkbox`
5. **自定义 Toast** — `ToastContainer` 是纯手写组件，不使用 shadcn `Sonner`
6. **缺少 Label** — 所有表单场景使用裸 `<label>` 标签而不是 shadcn `Label`
7. **版本号错误** — package.json 为 `2.0.0`，侧边栏显示 `Media Ingestion v2.1`，登录页显示 `v2.1`，应全部统一为 `0.5.0`
8. **暗色模式** — globals.css 已有 `.dark` 变量定义，但 `body` 样式仍硬编码 `bg-slate-50`/`color: #0f172a`，且无主题切换 UI
9. **滚动条** — 自定义滚动条使用硬编码色值，暗色下不适配

> [!IMPORTANT]
> 本次重构的核心原则是**用原生 shadcn CLI 安装的组件 1:1 替换手写组件**，同时将全部页面中的硬编码颜色迁移为语义 token，使亮暗模式自然切换。不做功能变更、不做 UI 视觉风格调整（颜色调优留给后续任务）。

## 已确认的实施决策

- 保留原生 `<select>`，统一使用 `native-select` 语义样式，兼顾移动端系统选择器。
- 本次迁移到 Sonner，通知容器放在应用根节点，覆盖登录与初始化页面。
- 使用 neutral 亮暗主题，业务状态继续使用成功、警告、信息与错误语义色；保留现有页面结构和业务流程。
- 按用户补充，当前发布版本为 **Git tag `v0.5.0`**，不是旧方案中的版本号。前后端发布版本跟随 tag，界面去掉 `v` 前缀；无 Git 信息时回退到项目元数据 `0.5.0`。
- 使用轻量 `ThemeProvider` 和 `useTheme`，同时处理系统偏好变化、跨标签页同步与浏览器存储不可用。

---

## Proposed Changes

### 1. shadcn UI 组件层 — 用 CLI 重新安装原生组件

#### [MODIFY] 通过 CLI `--overwrite` 重置全部 ui/ 组件

```bash
cd frontend
pnpm dlx shadcn@latest add button card input textarea badge progress \
  skeleton separator switch table tabs tooltip avatar alert alert-dialog \
  dialog dropdown-menu sheet label select checkbox radio-group sonner \
  --overwrite
```

这会将 `components/ui/` 下已有的 18 个组件全部替换为 shadcn 标准实现。新增组件：
- `label.tsx` — 替换裸 `<label>`
- `select.tsx` — 供有需要的场景使用（但保留原生 `<select>` 可选方案）
- `checkbox.tsx` — 替换 `<input type="checkbox">`
- `radio-group.tsx` — 替换 `<input type="radio">`
- `sonner.tsx` — 替换自定义 `ToastContainer`

#### 处理自定义 variant 的兼容策略

| 当前自定义项 | 处理方式 |
|---|---|
| `Badge` 的 `info`/`success`/`warning` | 安装原生后在组件内扩展 variants（shadcn 鼓励直接修改组件代码） |
| `Button` 的 `success`/`mobileTouch` | `success` 改为在调用处用 `className` 覆盖；`mobileTouch` size 已在 `min-h-[44px]` 触达，移除此 variant |
| `Progress` 的 `indicatorClassName` | 原生 shadcn Progress 不支持，保留此自定义扩展 |

---

### 2. 全局样式 & 暗色主题基础设施

#### [MODIFY] [globals.css](file:///codeworkspace/Kuroko/frontend/src/styles/globals.css)

- 将 `:root` 和 `.dark` 的 CSS 变量更新为 shadcn 最新的 **neutral/zinc** 黑白极简色系
- `body` 样式改用语义 token：`bg-background` / `text-foreground`
- 新增 `--sidebar`、`--chart` 等 shadcn v2 新增的语义变量
- 自定义滚动条使用语义色 `var(--muted-foreground)` 替换硬编码色值
- 新增 `@theme inline` 段补充缺失的 Tailwind v4 映射（`--color-sidebar`、`--color-chart-*` 等）

#### [NEW] [hooks/useTheme.ts](file:///codeworkspace/Kuroko/frontend/src/hooks/useTheme.ts)

新建主题切换 hook：
- 读取 `localStorage.getItem('kuroko-theme')`，支持 `light` / `dark` / `system` 三种模式
- 监听 `prefers-color-scheme` 变化自动跟随系统
- 在 `<html>` 元素上切换 `class="dark"`
- 导出 `theme`、`resolvedTheme`、`setTheme`

#### [MODIFY] [main.tsx](file:///codeworkspace/Kuroko/frontend/src/main.tsx)

- 在 `<App>` 外层或 `App` 内包裹 `ThemeProvider`（使用 `useTheme` hook 共享上下文并在首屏同步主题）
- 插入 inline `<script>` 到 `index.html` 防止 FOUC（Flash of Unstyled Content）

#### [MODIFY] [index.html](file:///codeworkspace/Kuroko/frontend/index.html)

- 在 `<head>` 添加 `<script>` 块，在 DOM 解析前根据 `localStorage` 和 `prefers-color-scheme` 预设 `class="dark"` 到 `<html>` 上

---

### 3. 布局层 — 适配暗色 + 语义化

#### [MODIFY] [AppLayout.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/AppLayout.tsx)

- `bg-slate-50` → `bg-background`

#### [MODIFY] [AppSidebar.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/AppSidebar.tsx)

- `bg-white` → `bg-card`
- `border-slate-200/80` → `border-border`
- `text-slate-900` → `text-foreground`
- `text-slate-600` → `text-muted-foreground`
- `bg-blue-50 text-blue-600` (active) → `bg-accent text-accent-foreground`
- `bg-slate-50 hover:bg-slate-100` (用户面板) → `bg-muted hover:bg-muted/80`
- 版本号 `Media Ingestion v2.1` → `0.5.0`
- 新增主题切换按钮（Sun/Moon 图标），调用 `useTheme` 切换

#### [MODIFY] [MobileTopNav.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/MobileTopNav.tsx)

- `bg-white/90` → `bg-background/90`
- `border-slate-200/80` → `border-border`
- `text-slate-900` → `text-foreground`
- `text-slate-600` → `text-muted-foreground`

#### [MODIFY] [BackgroundActivity.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/BackgroundActivity.tsx)

- 所有硬编码色值替换为语义 token

#### [MODIFY] [MagnetActivity.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/MagnetActivity.tsx)

- 同上

---

### 4. 通用组件层 — 语义化适配

#### [MODIFY] [StatCard.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/StatCard.tsx)

- `text-slate-500` → `text-muted-foreground`
- `bg-blue-50 text-blue-600` (图标背景) → `bg-primary/10 text-primary`
- `text-slate-900` → `text-foreground`

#### [DELETE] [ToastContainer.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/ToastContainer.tsx)

- 替换为 shadcn `Sonner`
- 在 `App.tsx` 中添加 `<Toaster />` 组件
- 重写 `stores/uiStore.ts` 中的 `toast` 快捷方法，改为调用 sonner 的 `toast()` API

#### [MODIFY] [EmptyState.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/EmptyState.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [PageHeader.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/PageHeader.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [StorageDirectoryField.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/StorageDirectoryField.tsx)

- `<label>` → shadcn `Label`
- 原生 `<select>` 样式使用语义 token

#### [MODIFY] [ScanProgress.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/ScanProgress.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [FileTree.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/FileTree.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [DuplicateReview.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/DuplicateReview.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [LazyMagnetFiles.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/LazyMagnetFiles.tsx)

- 硬编码色值替换为语义 token

#### [MODIFY] [SessionCheck.tsx](file:///codeworkspace/Kuroko/frontend/src/components/common/SessionCheck.tsx)

- 硬编码色值替换为语义 token

---

### 5. 页面层 — 语义化迁移

#### [MODIFY] [Login.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Login.tsx)

- `bg-slate-50` → `bg-background`
- `text-slate-900` → `text-foreground`
- `text-slate-500` → `text-muted-foreground`
- `bg-blue-600` → `bg-primary`
- 版本号 `v2.1` → `0.5.0`
- 裸 `<label>` → shadcn `Label`
- 所有 `border-slate-*` → `border-border`

#### [MODIFY] [Bootstrap.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Bootstrap.tsx)

- 同 Login.tsx 模式
- `bg-slate-50` → `bg-background`
- 所有硬编码色值语义化

#### [MODIFY] [Dashboard.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Dashboard.tsx)

- 所有硬编码色值替换（`text-slate-*`、`bg-slate-*`、`text-blue-*`、`border-slate-*`）
- 裸 `<label>` → shadcn `Label`（如果有）
- `StatusBadge` 中的 variant（`info`/`success`）保留（在 Badge 组件中已扩展）

#### [MODIFY] [MagnetParser.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/MagnetParser.tsx)

- 原生 `<input type="radio">` → shadcn `RadioGroup` + `RadioGroupItem`
- 原生 `<select>` → 保留原生但使用语义 token 样式类
- 所有硬编码色值语义化
- 裸 `<label>` → shadcn `Label`

#### [MODIFY] [Codes.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Codes.tsx)

- 原生 `<select>` → 保留原生但统一语义 token
- 硬编码色值替换
- `text-slate-400` → `text-muted-foreground` 等

#### [MODIFY] [Tasks.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Tasks.tsx)

- 硬编码色值替换（已部分使用语义 token）
- 确保表格到卡片的移动端切换正常

#### [MODIFY] [Settings.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Settings.tsx)

- 原生 `<select>` → 保留原生但使用语义 token
- 裸 `<label>` → shadcn `Label`
- 硬编码色值替换
- `Alert` 成功状态的硬编码 `border-emerald-200 bg-emerald-50` → 在 Alert 组件中扩展 `success` variant 或使用 className

#### [MODIFY] [Storages.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Storages.tsx)

- 原生 `<input type="checkbox">` → shadcn `Checkbox`
- 硬编码色值替换
- 裸 `<label>` → shadcn `Label`

#### [MODIFY] [NotFound.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/NotFound.tsx)

- 硬编码色值替换

---

### 6. 状态管理层

#### [MODIFY] [stores/uiStore.ts](file:///codeworkspace/Kuroko/frontend/src/stores/uiStore.ts)

- 移除 `toasts` 状态和 `addToast`/`removeToast` 方法
- `toast` 快捷方法改为包装 sonner API：
  ```ts
  import { toast as sonnerToast } from 'sonner'
  export const toast = {
    success: (message: string) => sonnerToast.success(message),
    error: (message: string) => sonnerToast.error(message),
    warning: (message: string) => sonnerToast.warning(message),
    info: (message: string) => sonnerToast.info(message),
  }
  ```

---

### 7. 版本号统一

| 位置 | 实施方式 |
|---|---|
| `frontend/package.json`、`backend/pyproject.toml` | 元数据统一为 `0.5.0`，作为无 Git 信息时的回退值 |
| `frontend/scripts/version.ts` | 构建参数 `KUROKO_VERSION` → 当前提交可追溯的最新 Git tag → package.json |
| `AppSidebar.tsx`、`Login.tsx` | 使用 Vite 注入的 `APP_VERSION`，避免重复硬编码 |
| `backend/app/core/version.py` | 环境变量 `KUROKO_VERSION` → 当前提交可追溯的最新 Git tag → pyproject.toml |
| FastAPI、`/api/v1/health` | 使用同一版本值，健康检查新增 `data.version` |
| Docker、GitHub Actions | 构建参数把同一 tag 注入前端构建与后端运行阶段，容器冒烟检查版本一致性 |

版本统一去掉 `v` 前缀，保留合法的预发布与构建标记；拒绝无效版本和超过 128 字符的输入。Git 读取有超时保护，不携带 Git 信息的镜像由发布工作流传入版本。

---

### 8. 依赖变更

#### [MODIFY] [package.json](file:///codeworkspace/Kuroko/frontend/package.json)

新增依赖（由 shadcn CLI 自动添加）：
- `@radix-ui/react-label` — Label 组件
- `@radix-ui/react-select` — Select 组件
- `@radix-ui/react-checkbox` — Checkbox 组件
- `@radix-ui/react-radio-group` — RadioGroup 组件
- `@radix-ui/react-progress` — 原生 Progress（如需用 Radix 版）
- `sonner` — Toast 替代方案
- `tw-animate-css` — 补齐 Tailwind v4 下的标准组件动画；主题由本地 ThemeProvider 管理，无需 next-themes

---

## Verification Plan

### Automated Tests

```bash
cd frontend
pnpm run lint          # oxlint 静态检查
pnpm run build         # TypeScript 编译 + Vite 构建，确保零错误
pnpm run test          # 业务回归与 Git tag 版本解析
```

### Manual Verification

1. **亮色模式**：启动 `pnpm dev`，逐一访问全部页面（Login、Bootstrap、Dashboard、MagnetParser、Tasks、Codes、Settings、Storages、NotFound），确认：
   - 无硬编码色值残留（文字、背景、边框均正确）
   - 卡片内文字无偏移
   - 移动端（Chrome DevTools 375px 宽度模拟）布局正常，触摸目标 ≥ 44px

2. **暗色模式**：切换到暗色，重复上述页面检查：
   - 背景为深色、文字为浅色
   - 侧边栏、移动端导航、弹窗均正确适配
   - Toast 通知暗色下可见

3. **主题切换**：
   - 侧边栏底部或顶部有主题切换按钮
   - `system` 模式跟随系统偏好
   - 刷新页面后主题保持（无 FOUC）

4. **版本号**：
   - 侧边栏显示 `0.5.0`（不带 v 前缀）
   - 登录页底部显示 `0.5.0`（不带 v 前缀）
   - `package.json` 和 `pyproject.toml` 的回退版本为 `0.5.0`
   - 后续发布更高版本 tag 时，前后端构建自动同步，健康检查与 OpenAPI 版本一致

5. **响应式**：
   - 桌面端（≥1024px）：侧边栏常驻，主内容区自适应
   - 平板端（768-1023px）：侧边栏隐藏，点击汉堡菜单 Sheet 弹出
   - 手机端（<768px）：卡片单列堆叠，表格转卡片，所有按钮 min-h-[44px]

## 实施与验收记录（2026-09-15）

- 已通过 shadcn CLI 覆盖或校验原有组件，补齐 Label、Select、Checkbox、RadioGroup 和 Sonner；保留移动端原生下拉选择与必要的状态扩展。0.5.0 的手工番号输入也已使用标准 Input，并按后端契约限制为 64 字符。
- 已完成 neutral 语义色迁移、三种主题偏好、首屏预设、系统跟随和跨标签页同步；登录、初始化、弹窗与通知均使用统一主题。
- 前端 `pnpm lint`、`pnpm test`（6 个测试文件）和 `pnpm build` 通过；新版本解析测试覆盖 tag、构建参数优先级、无 Git 回退与无效版本。
- Chrome 使用模拟 API 在 1440px、834px、375px 下验证亮暗主题，共通过 88 项页面／表单检查和 6 项磁力详情检查，无页面脚本异常或横向溢出。另验证主题刷新持久化、系统变化、存储禁用、非法缓存、首屏预设和四类通知。
- 后端版本与 API 回归通过 50 项测试；Docker 使用独立测试版本 `v0.5.0-verification` 完成构建、首次启动和重启检查，确认前端产物、健康检查与 OpenAPI 版本一致。
- 剩余提示：Vite 主包约 763 kB（gzip 约 235 kB），仍提示超过 500 kB；本机 pytest 存在既有 `asyncio_mode` 配置告警。浏览器业务数据使用替身，本次未连接真实网盘服务。
