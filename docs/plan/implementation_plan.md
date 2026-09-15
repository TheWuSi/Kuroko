# 前端重构：原生 shadcn 组件 + 亮暗主题 + 版本号同步

## 背景

当前前端的 `components/ui/` 下有 18 个组件，大部分已经是手动仿写的 shadcn 风格，但存在以下问题：
1. **硬编码颜色** — 组件内大量使用 `text-slate-900`、`bg-blue-600`、`border-slate-200` 等直接色值，而非 shadcn 语义 token（`bg-card`、`text-foreground`、`border-border`），导致无法适配暗色主题
2. **自定义 variant** — `Badge`（`info`/`success`/`warning`）、`Button`（`success`/`mobileTouch`）、`Progress`（`indicatorClassName`）等在标准 shadcn 中不存在
3. **原生 HTML `<select>`** — 多处（Settings、MagnetParser、Codes、Storages）使用 `<select>` 替代 shadcn `Select` 组件
4. **原生 `<input type="radio">`、`<input type="checkbox">`** — MagnetParser、Storages 中未使用 shadcn `RadioGroup`、`Checkbox`
5. **自定义 Toast** — `ToastContainer` 是纯手写组件，不使用 shadcn `Sonner`
6. **缺少 Label** — 所有表单场景使用裸 `<label>` 标签而不是 shadcn `Label`
7. **版本号错误** — package.json 为 `2.0.0`，侧边栏显示 `Media Ingestion v2.1`，登录页显示 `v2.1`，应全部统一为 `0.4.0`
8. **暗色模式** — globals.css 已有 `.dark` 变量定义，但 `body` 样式仍硬编码 `bg-slate-50`/`color: #0f172a`，且无主题切换 UI
9. **滚动条** — 自定义滚动条使用硬编码色值，暗色下不适配

> [!IMPORTANT]
> 本次重构的核心原则是**用原生 shadcn CLI 安装的组件 1:1 替换手写组件**，同时将全部页面中的硬编码颜色迁移为语义 token，使亮暗模式自然切换。不做功能变更、不做 UI 视觉风格调整（颜色调优留给后续任务）。

## Open Questions

> [!IMPORTANT]
> 1. **shadcn `Select` vs 原生 `<select>`**：原生 `<select>` 在移动端的体验通常优于 Radix Select（原生会弹出系统级选择器），是否仍要全部替换为 shadcn `Select`？建议保留原生 `<select>` 但统一用 shadcn 语义 token 做样式适配。
> 2. **Toast 替换为 Sonner**：shadcn 官方推荐使用 `sonner`。替换后整个 `useUiStore` 的 toast 系统和 `ToastContainer` 需要重写，影响范围较大。是否本次就做？
> 3. **极简黑白风格**：你提到"黑色极简/白色极简"，目前 globals.css 里 `:root`（亮色）使用 slate 蓝灰色系，`.dark` 使用深蓝灰色系。是否要换成**纯黑白**（neutral 色系），还是先保持当前色系仅确保亮暗切换可用，后续再调色？
> 4. **后端 main.py 版本号**：后端 `pyproject.toml` 已是 `0.4.0`，但 `app/main.py` 中 FastAPI `version="0.1.0"`，是否一并修正？

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
- `body` 样式改用语义 token：`background-color: hsl(var(--background))` / `color: hsl(var(--foreground))`
- 新增 `--sidebar`、`--chart` 等 shadcn v2 新增的语义变量
- 自定义滚动条使用语义色 `hsl(var(--muted-foreground))` 替换硬编码色值
- 新增 `@theme inline` 段补充缺失的 Tailwind v4 映射（`--color-sidebar`、`--color-chart-*` 等）

#### [NEW] [hooks/useTheme.ts](file:///codeworkspace/Kuroko/frontend/src/hooks/useTheme.ts)

新建主题切换 hook：
- 读取 `localStorage.getItem('kuroko-theme')`，支持 `light` / `dark` / `system` 三种模式
- 监听 `prefers-color-scheme` 变化自动跟随系统
- 在 `<html>` 元素上切换 `class="dark"`
- 导出 `theme`、`resolvedTheme`、`setTheme`

#### [MODIFY] [main.tsx](file:///codeworkspace/Kuroko/frontend/src/main.tsx)

- 在 `<App>` 外层或 `App` 内包裹 `ThemeProvider`（使用 `useTheme` hook 在 `useEffect` 初始化）
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
- 版本号 `Media Ingestion v2.1` → `0.4.0`
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
- 版本号 `v2.1` → `0.4.0`
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

| 位置 | 当前值 | 目标值 |
|---|---|---|
| [package.json](file:///codeworkspace/Kuroko/frontend/package.json) L4 | `"2.0.0"` | `"0.4.0"` |
| [AppSidebar.tsx](file:///codeworkspace/Kuroko/frontend/src/components/layout/AppSidebar.tsx) L52 | `Media Ingestion v2.1` | `0.4.0` |
| [Login.tsx](file:///codeworkspace/Kuroko/frontend/src/pages/Login.tsx) L150 | `v2.1` | `0.4.0` |

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
- `next-themes`（可选）— 或自行实现 useTheme

---

## Verification Plan

### Automated Tests

```bash
cd frontend
pnpm run lint          # oxlint 静态检查
pnpm run build         # TypeScript 编译 + Vite 构建，确保零错误
```

### Manual Verification

1. **亮色模式**：启动 `pnpm dev`，逐一访问全部 7 个页面（Login、Bootstrap、Dashboard、MagnetParser、Tasks、Codes、Settings、Storages），确认：
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
   - 侧边栏显示 `0.4.0`（不带 v 前缀）
   - 登录页底部显示 `0.4.0`（不带 v 前缀）
   - `package.json` version 为 `0.4.0`

5. **响应式**：
   - 桌面端（≥1024px）：侧边栏常驻，主内容区自适应
   - 平板端（768-1023px）：侧边栏隐藏，点击汉堡菜单 Sheet 弹出
   - 手机端（<768px）：卡片单列堆叠，表格转卡片，所有按钮 min-h-[44px]
