# Kuroko 开发与重构实施计划提示词 (Plan Prompt)

> **文档说明**：本提示词用于直接交付给后续开发 Agent 或开发者，作为执行 Kuroko 系统前端完全重写、后端引入 `magnet-metadata-api` 与功能查漏补缺的标准化任务指令。

---

## 角色定义与任务背景

你是一名全栈高级系统架构师与资深前端/后端工程师。当前任务是对开源项目 **Kuroko**（基于 OpenList API 的磁力链接番号管理与自动化离线下载系统）进行核心迭代与重构：
1. **前端彻底摒弃与重构**：完全推翻现有简陋原型，基于 **Vite + React 19 + TypeScript + Zustand + Shadcn/ui + Tailwind CSS (v4) + Axios** 构建现代化高颜值 Web 应用。严格贯彻**亮色优先（Light-First Mode）白瓷科技美术设计方案（Porcelain Tech）**，同时支持暗色切换；并且必须做到**全端响应式适配（移动端手机、平板、PC 完美适配）**。
2. **后端引入 `magnet-metadata-api`**：全面接入 [felipemarinho97/magnet-metadata-api](https://github.com/felipemarinho97/magnet-metadata-api)，替换原有虚构的解析接口，实现基于 DHT/P2P 的元数据高效解析、超时容错与优雅降级。
3. **后端系统级查漏补缺**：严格对照 12 条核心业务需求，对番号识别规则、前端/后端实时 Tracker 清理、去重拦截与强制下载、碎片优先算法（Best-Fit Minimal Remainder）、定向探测路径扫描解耦（拆出 `code_service.py`）、多源空间统计、在线配置热更新、GitHub Actions CI/CD 与 Docker Compose 编排进行全量加固。

---

## 核心遵守规范 (AGENTS.md & 实施红线)

1. **中文默认**：用户可见 UI、注释、文档及 Git Commit 默认使用**简体中文**。代码标识符使用标准英文。
2. **【绝对红线】保护用户真实配置**：
   - **绝对禁止修改、覆盖或重置用户已在数据库、环境变量或配置文件中配置的 OpenList 真实参数**；
   - 数据库迁移和配置加载逻辑必须具有无损合并能力，严禁无差别清库或恢复出厂配置。
3. **亮色优先与高审美设计保障 (针对美术薄弱的 Agent 强制约束)**：
   - 界面**默认采用亮色模式 (Light-First)**，呈现通透高质感的白瓷科技风（Porcelain Tech）；
   - 必须严格执行 `docs/dev/frontend-revamp-plan.md` 中定义的具象色彩令牌与 Tailwind 类组合，严禁自由发挥导致界面粗糙。
4. **全端响应式与手机端适配硬性标准**：
   - 必须适配手机端（`< 640px`）：顶部导航带抽屉、触控热区 `>= 44px`、表格在移动端**必须自动转为垂直卡片流（严禁横向溢出断裂）**。
5. **敏感数据防护**：Token、密码、密钥禁止明文落盘日志；前端脱敏展示（如 `sk-****`）。
6. **输入与安全防护**：对磁力链接、正则表达式、路径遍历做严格防御性校验与边界保护。
7. **高质量与最小闭环**：遵循 KISS、DRY、SOLID 原则。复杂逻辑必须附带**中文注释**，重点解释“为什么这样做”。
8. **分批次与充分验证**：每个阶段必须通过静态检查、类型检查、单测或构建验证（`pnpm lint` / `pnpm build` / `pytest`）。
9. **强制 Git 提交规范**：
   - 任务或阶段开发完成并通过验证后，**必须将所有工作区内容完整提交至 Git 仓库**；
   - **第一行 (Subject)**：必须使用**中文概要**（如 `feat(frontend): 重构前端界面并落地亮色优先响应式美术方案`）；
   - **附加信息 (Body)**：空一行后必须详尽书写**中文具体操作内容**，逐条记录改动细节与验证结果。

---

## 阶段一：前端完全重构与亮色优先响应式美术方案落地

### 1.1 架构与目录重新规划
摒弃原有粗糙组件，建立标准现代化目录体系：
```text
frontend/src/
├── app/                  # 路由配置 (React Router v7)、路由鉴权守卫 (RequireAuth)、页面懒加载
├── assets/               # 矢量图形、Logo、占位图
├── components/
│   ├── ui/               # 完备纯净的 Shadcn/ui 原子组件 (亮色默认，支持 Dark)
│   │   ├── button.tsx, badge.tsx, card.tsx, dialog.tsx, sheet.tsx, drawer.tsx,
│   │   ├── input.tsx, label.tsx, progress.tsx, table.tsx, tabs.tsx, tooltip.tsx
│   ├── common/           # 跨业务通用组件
│   │   ├── PageHeader.tsx    # 自适应标题区与面包屑 (移动端紧凑排布)
│   │   ├── StatCard.tsx      # 亮色指标卡片 (带浅蓝微阴影)
│   │   ├── EmptyState.tsx    # 优雅空状态插画与引导
│   │   ├── ResponsiveTable.tsx # 响应式智能表格 (桌面端表格，手机端卡片流)
│   │   └── FileTree.tsx      # 磁力/目录树状展开器
│   ├── layout/           # 框架布局组件
│   │   ├── AppLayout.tsx     # 响应式骨架容器
│   │   ├── AppSidebar.tsx    # 桌面端侧边栏 (lg 以上常驻)
│   │   ├── MobileTopNav.tsx  # 移动端顶部导航 (带 Sheet 汉堡抽屉)
│   │   └── ThemeToggle.tsx   # 主题切换器 (默认 Light 优先)
│   └── features/         # 核心业务特性组件
│       ├── magnet/       # 磁力输入即时清理器、解析文件树、番号去重状态卡片、强制下载交互
│       ├── task/         # 任务监控表格/手机卡片流、实时进度条、传输速率趋势、操作按钮组
│       ├── code/         # 番号资产卡片网格、定向扫描浮动抽屉、黑名单高亮
│       ├── storage/      # 存储节点拓扑卡片、碎片率仪表盘、手动容量配置弹窗
│       └── settings/     # 分模块设置面板 (OpenList, BT解析, 过滤规则 Tag, 探测路径)
├── hooks/                # 纯业务逻辑 Hooks (useMagnetCleaner, useTaskPolling, useMediaQuery, useDebounce)
├── stores/               # Zustand 状态切片 (authStore, uiStore, taskStore, configStore)
├── services/             # 领域 API 与 Axios 客户端 (请求取消 CancelToken, 401 会话隔离, 错误统一拦截)
├── types/                # 完整强类型契约 (领域实体、API 响应、表单入参)
├── styles/               # 样式与主题 (Tailwind v4 主题变量、亮色优先设计规范)
└── lib/                  # 工具类 (formatters, validators, magnetCleaner, cn)
```

### 1.2 美术设计方案 (Porcelain Tech 亮色优先) 严格执行
> **实施 Agent 照抄模板**：
- **基调**：纯净通透白瓷风，底色 `bg-slate-50`，卡片 `bg-white`，细腻边框 `border-slate-200/80`，微阴影 `shadow-sm shadow-slate-900/5`；
- **排版字体**：UI 界面采用 `Inter, system-ui, sans-serif`；番号（如 `ABC-123`）、磁力 Hash、文件路径与容量必须使用等宽字体 `font-mono tracking-wide font-medium`；
- **状态语义色**：
  - 可下载/成功：`bg-emerald-50 text-emerald-700 border-emerald-200`
  - 库内存在/跳过：`bg-amber-50 text-amber-700 border-amber-200`
  - 错误/已满：`bg-rose-50 text-rose-700 border-rose-200`
  - 处理中/扫描中：`bg-violet-50 text-violet-700 border-violet-200`
- **动态微交互**：
  - **磁力输入框**：用户粘贴磁力后前端即刻剔除 `tr` 等参数并弹出微光 Badge 提示，平滑保留 `xt` 和 `dn`；
  - **Best-Fit 算法高光**：存储卡片展示碎片命中光效 `ring-2 ring-blue-500/50` 与推荐徽章；
  - **下载任务同步**：状态胶囊带有脉冲呼吸灯。

### 1.3 移动端全响应式设计规范
1. **触控标准**：所有按钮及点击区最小高宽 `44px`；
2. **导航转换**：桌面端常驻左侧侧边栏，移动端自动切换为顶部极简 TopBar + 点击汉堡图标呼出 Shadcn `Sheet` 抽屉导航；
3. **表格转卡片（Table-to-Card）**：
   - 任务列表与番号列表在移动端自动降级为垂直卡片流，每张卡片展示番号、状态 Badge、进度条与操作按钮，严禁出现横向断裂滚动条；
4. **弹窗适配**：PC 端使用居中 Dialog，移动端自动平滑降级为底部抽屉 Drawer。

---

## 阶段二：后端引入 `magnet-metadata-api` 与客户端重构

### 2.1 依赖与通信协议对接
- 服务项目：`https://github.com/felipemarinho97/magnet-metadata-api`
- API 规范：`POST /api/v1/metadata`
  - 入参：`{"magnet_uri": "magnet:?xt=urn:btih:..."}`
  - 出参：`{"info_hash": "...", "name": "...", "size": 123456, "files": [{"path": "...", "size": 123, "offset": 0}]}`
- 客户端重构：创建 `backend/app/services/magnet_metadata_client.py`，替代原有简易 `BtParserClient`。
  - 支持配置请求超时（默认 45s，可根据网络环境配置）；
  - 具备优雅降级机制：若 DHT 元数据解析超时，回退至基于 `dn` 的初步提取，并在结果中标记 `metadata_fallback=true` 提示用户。
- 连通性测试：新增 `POST /api/v1/config/test-bt-parser` 接口，支持前端测试 `magnet-metadata-api` 的可用性与响应延迟。

---

## 阶段三：后端系统级查漏补缺与服务解耦

对照 12 条核心需求全面检视并加固：
1. **服务分层解耦**：
   - 新建 `backend/app/services/code_service.py`，将原本散落在 `api/v1/codes.py` 中的 `run_scan`、探测路径递归、规则过滤、入库操作完整下沉，彻底解决内存锁与分层越界问题。
2. **番号正则扩展 (需求 2.1)**：
   - 扩展 `DEFAULT_CODE_PATTERN`，不仅支持标准 `ABC-123`，还兼容 `T28-xxx`, `FC2-PPV-xxx`, `HEYZO-xxx`, 无连字符及纯数字等变种；
   - 支持从系统配置中读取用户自定义正则规则。
3. **去重与强制下载机制 (需求 2.5, 9.3)**：
   - 批量提交下载任务时，已存在的番号默认进入 `skipped` 队列，前端清晰展示跳过原因和库内已有文件路径；
   - 提交任务支持 `force: true` 参数，允许用户对被跳过的任务显式强制下载（适用于字幕版、高清版）。
4. **碎片空间优先调度算法 (需求 8)**：
   - 完善 `choose_target`：在满足 `free_space >= required_size` 的候选挂载节点中，优先选择**剩余空间最小**（Best-Fit）的节点；
   - 若单节点空间不足，自动顺延到下一个节点；全组不足时拦截下发并标记节点状态；
   - 明确回传规划的目标落地完整路径（例如 `/OD/Video1/ABC-123`）。
5. **下载完成后增量入库无需重扫 (需求 9.2)**：
   - 任务轮询检测到已完成状态后，自动从 OpenList 元数据或规划路径中提取番号并追加写入 `CodeRecord` 表，无需全盘扫库。
6. **OpenList 客户端强化 (需求 3, 5, 10)**：
   - 完善账号密码登录换 Token 与过期自动刷新逻辑；
   - 固化离线下载参数：`tool: "pikpak"`, `delete_policy: "always"`；
   - **保护真实配置**：保持现有数据库已有配置无损。
7. **CI/CD 与 Docker 部署 (需求 11, 12)**：
   - 编写 `.github/workflows/ci-cd.yml`，在 push tag（`v*`）时自动构建前后端合一 Docker 镜像推送到 GHCR；
   - 编写 `docker-compose.yml`，编排 `kuroko`、`magnet-metadata-api` 与 `redis` 容器，支持通过环境变量自定义前后端端口与挂载目录。

---

## 阶段四：验证与质量门禁

1. **后端验证**：
   - 单元测试与集成测试通过：`pytest`
   - 语法检查与格式检查：`ruff check` 或 `flake8`
2. **前端验证**：
   - 代码检查与格式：`pnpm lint`、`pnpm format:check`
   - 类型检查：`tsc -b`
   - 自动化测试：`pnpm test`
   - 生产打包：`pnpm build`（验证 SPA 资源生成完整性）
   - **响应式视口抽检**：通过浏览器 DevTools 验证 375px (iPhone SE)、390px (iPhone 13/14) 与 768px (iPad) 布局无横向滚动条、无元素重叠。
3. **联调验证**：
   - 验证磁力输入清洗、BT 解析提取、番号去重、强制下载、智能选盘与在线配置全链路畅通。

---

## 阶段五：代码提交与 Git 规范执行 (Git Submission Standard)

完成阶段四所有验证并通过质量门禁后，**必须将当前工作区所有改动完整提交至本地 Git 仓库**：

### 5.1 提交前工作区完整性检查
- 执行 `git status -s`，核对所有改动、新增及配置文件；
- 确保无残留临时垃圾文件，确保 `.gitignore` 生效。

### 5.2 提交格式规范 (Commit Message Format)
- **第一行 (Subject)**：必须为**中文概要**，格式为 `<类型>(<范围>): <中文概要说明>`。
- **空一行**。
- **正文部分 (Body / 附加信息)**：必须详尽书写**中文详细操作记录**，涵盖改动细节、关键设计与验证结果。

### 5.3 提交命令与模板示例

```bash
git add -A
git commit -F - << 'EOF'
feat: 完成前端亮色响应式重构与后端服务加固

本次提交完成的核心操作如下：
1. 前端彻底重构 (亮色优先与全端响应式)：
   - 基于 Vite + React 19 + TypeScript + Zustand + Shadcn/ui + Tailwind v4 重新搭建工程结构；
   - 落实 Porcelain Tech 亮色优先设计系统，配置舒适的 slate-50/white 层次与 JetBrains Mono 等宽排版；
   - 全面实现移动端适配：顶部 Sheet 汉堡导航、44px 触控区、任务列表与番号列表自动转为卡片流；
   - 实现磁力输入实时 Tracker 净化微动效、树形文件过滤展示、跳过列表与强制下载通道；
   - 实现 10 秒增量任务轮询、存储碎片率仪表盘与系统设置可视化面板。
2. 后端查漏补缺与解析接入：
   - 引入 felipemarinho97/magnet-metadata-api，重构 MagnetMetadataApiClient 适配器，支持 DHT 异步提取与超时优雅降级；
   - 解耦 codes 路由层，新增 services/code_service.py 独立管理定向探测路径扫描任务；
   - 完善 Best-Fit 碎片优先选盘算法、节点顺延与满载标记，输出明确落地路径；
   - 强化 OpenList 客户端鉴权并严格保护用户现有真实配置。
3. 容器编排与 CI/CD：
   - 编写联合编排 docker-compose.yml（kuroko + magnet-metadata-api + redis）；
   - 配置 GitHub Actions push tag 自动构建与发布流水线。
4. 验证结果：
   - 前端 pnpm lint, pnpm format:check, tsc -b, pnpm test, pnpm build 全部通过；
   - 后端 pytest 单元测试与集成测试全部通过；
   - 移动端 375px/390px 视口检查无横向滚动条。
EOF
```
