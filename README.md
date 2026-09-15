# Kuroko

> 基于 OpenList API 的磁力链接番号管理与离线下载系统

## 功能特性

- 🧲 **磁力链接解析** — 清理 tracker、提取番号、过滤展示文件；下载仍包含整个种子
- 🔍 **番号去重** — 分组内跨盘查重，区分 FC2 分集，持久化允许不同版本共存
- ⬇️ **离线下载** — 通过 OpenList 调用 PikPak，直接下载到指定目录，不追加番号子目录
- 📊 **智能调度** — 分组节点按优先级选盘，空间不足顺延，逐个配置下载与归档目录
- 📈 **进度同步** — 分别展示离线与转存进度，库内文件由实际扫描确认
- 💾 **空间统计** — 缓存容量与分组结果，手动配额可恢复自动，未知项按零汇总
- 🗂️ **番号统计** — 后台长任务扫描，可取消和恢复跟踪，同时显示番号数与文件数
- ⚙️ **在线配置** — 所有配置项支持前端在线修改

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.12+, FastAPI, SQLAlchemy 2, Pydantic 2, Alembic |
| 前端 | React 19, TypeScript, React Router v7, Vite, pnpm |
| UI 与样式 | shadcn/ui, Radix UI, Tailwind CSS v4 |
| 状态与请求 | Zustand, Axios |
| 代码质量 | Ruff, Pytest, Oxlint, TypeScript |
| 数据库 | SQLite + Alembic 迁移 |
| 构建 | Make |
| 部署 | Docker, Docker Compose |
| CI/CD | GitHub Actions |

## 快速开始

### Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/<owner>/Kuroko.git
cd Kuroko

# 复制环境变量
cp .env.example .env
# 编辑 .env，至少修改 KUROKO_SECRET_KEY

# 启动服务
docker compose up -d --build
```

访问 `http://localhost:8000` 进入界面。

首次访问会进入管理员初始化页面，不存在固定默认密码。生产环境如果仍使用 `change-me-in-production`，服务会拒绝启动。

使用 GHCR 预构建镜像时，在 `.env` 中设置 `KUROKO_IMAGE=ghcr.io/<owner>/kuroko:<version>`，将 `<owner>` 和 `<version>` 替换为实际仓库所有者（小写）及镜像版本，然后执行：

```bash
docker compose pull kuroko
docker compose up -d --no-build
```

更新时修改镜像版本并重复执行以上命令，继续使用原有 `config/`、`data/`、`logs/` 持久化目录。修复镜像发布后，需要拉取新镜像并重建容器才能生效。

### 本地开发

```bash
# 安装依赖
make install

# 启动后端开发服务器
make dev-backend

# 启动前端开发服务器（另一个终端）
make dev-frontend
```

### CI 与镜像发布

`CI` 在向 `main/master` 推送或创建、更新 PR 时检查后端、前端及容器启动。`Docker Release` 在推送 `v*` 标签时复用完整 CI，通过后发布 GHCR 镜像；同一标签只有一个发布工作流。

镜像支持 `linux/amd64` 和 `linux/arm64`。正式版本 `vX.Y.Z` 同时提供 `vX.Y.Z`、`X.Y.Z`、`X.Y` 和 `latest` 标签，`latest` 沿用每次匹配标签发布时更新的规则。启动冒烟检查在 amd64 镜像中验证新库迁移、健康接口、前端首页及重启后的数据保留，发布后检查两种架构的镜像清单。

界面、后端 OpenAPI 和 `/api/v1/health` 的 `data.version` 使用同一发布版本，显示时去掉 `v` 前缀。发布工作流通过构建参数 `KUROKO_VERSION` 将 Git tag 同时注入前后端；本地开发读取当前提交可追溯的最新版本 tag。没有 Git 信息且未传构建参数时，分别回退到 `frontend/package.json` 与 `backend/pyproject.toml` 的版本（当前为 `0.5.0`）。

本地可执行同样的镜像检查，需要 Docker 和 Python 3：

```bash
docker build --platform linux/amd64 \
  --build-arg KUROKO_VERSION="$(git describe --tags --abbrev=0 --match 'v[0-9]*' --match '[0-9]*')" \
  -t kuroko:smoke .
bash scripts/verify/docker-smoke.sh kuroko:smoke
```

界面支持亮色、暗色和跟随系统，可在登录页、初始化页、侧边栏或移动端顶部切换。偏好保存在当前浏览器的 `kuroko-theme` 中，刷新后保持，并同步到同源标签页。

## 前置要求

- 已部署 [OpenList v4.2.6](https://github.com/OpenListTeam/OpenList/tree/v4.2.6)，使用管理员账号或管理员令牌
- OpenList 中已挂载 PikPak、配置离线临时目录，目标路径支持 PikPak 离线工具；离线、转存及清理由 OpenList 执行
- Compose 固定使用 `magnet-metadata-api:0.1.0`；解析服务不可用时仍可指定目录下载，自动容量调度需要完整元数据大小

## 接入与容量说明

在系统设置中填写 OpenList 地址及凭据，并测试连接；测试使用表单当前值，不会自动保存。OpenList 请求使用原始 `Authorization: <token>`；Kuroko 自身 API 继续使用 JWT Bearer。官方接口索引见 [OpenList llms.txt](https://fox.oplist.org/llms.txt)。

磁力工作台支持选择 OpenList 挂载并浏览目录，也可使用分组已保存的下载目录，或切换为“分组自动选盘”。自动选盘用完整种子大小调度，排除容量未知、不可用及已忽略节点，并保守计入活动任务预留。优先使用优先级最高且空间足够的节点，同优先级按最小剩余空间选择，空间不足再顺延。URI 保留 `xt=urn:btih:` 的冒号，显示名单独编码。文件过滤只用于识别与展示，下载仍包含整个种子；“离线完成”后还需检查转存任务，扫描实际文件后才更新番号库。

在“存储节点与分组”中勾选网盘，为每个成员配置下载目录、归档目录和 0～9999 的整数优先级，数值越大越优先。同一网盘可加入多个分组。媒体库扫描前会展示完整目录范围，扫描后列出组内重复文件；`FC2-1234567` 与 `FC2-PPV-1234567` 统一处理。`FC2-1234567.mp4` 与 `FC2-1234567(1).mp4` 视为不同分集，也支持数字、CD、part 后缀；同版本的同一分集重复仍提示。允许 `-C/-UC/-U` 等版本共存后，规则在移动文件或重新扫描后继续生效，可在“已允许组合”中撤销。查重项目展示下载／归档目录与实际路径，每项右侧都有共存按钮，真正重复时禁用并说明原因。

存储节点与分组在同一浏览器会话中跨页面、跨刷新复用成功结果，显示上次更新时间；离线、转存或扫描任务结束、相关配置变更以及手动刷新时更新。手动配额可通过“恢复自动获取”删除覆盖值，原生容量不可用时显示未知。

节点可加入“忽略项”，同时隐藏、停止下载分配、跳过扫描并排除容量汇总；已有配置与索引保留，随时可恢复。未知容量在单节点继续显示未知，汇总时按零计算。未分组目录仍可直接下载，界面会提示当前只检查该目录范围。

服务启动自动执行数据库迁移，兼容没有版本表、空版本表及新旧表混合的完整旧库，保留账号、任务与原下载目录，合并可匹配的旧探测目录。升级在事务中执行，失败可回滚。扫描只更新索引；只有目录完整读取成功才移除失效记录，不移动、重命名或删除实际文件。定向扫描不再受五分钟总时限限制，保留单次请求超时与目录／文件数量上限；可关闭面板或刷新浏览器后继续跟踪，也可请求取消，未完成范围的旧索引保留。服务重启后扫描标记为中断，可重新发起。`make test` 执行后端业务、迁移测试以及前端磁力、容量与缓存回归。

**OneDrive 手动配额统计失败**：手动设置的是总容量，仍需要已用容量才能计算剩余空间。系统优先读取存储列表的 `mount_details`，缺失时再查询挂载根目录，最后才尝试有时间与数量限制的目录统计。OneDrive 的容量查询可能较慢，也可能关闭了 `disable_disk_usage` 对应的容量功能；GoogleDrive 若已返回原生用量，就无需递归统计。页面会显示具体失败原因，统计不完整时保持“未知”。请检查 OpenList 挂载中的容量统计开关、容量显示设置，以及 OneDrive 授权/Graph API 错误日志。

Compose 将元数据缓存持久化到 `./data/metadata`，容器内显式使用 `/app/cache`，并映射 `METADATA_CLIENT_PORT`（默认 42069）的 TCP/UDP 端口供 DHT/Peer 使用。健康检查为 `/api/v1/health`，只表示服务可用。元数据 HTTP 端口默认只绑定本机；Kuroko 容器通过 `http://magnet-metadata-api:8080` 访问。

本地直接启动后端时，请在设置中把解析地址改为 `http://127.0.0.1:8080`，或设置 `KUROKO_BT_PARSER_SERVICE_URL`。生产反向代理应为解析/提交请求保留足够等待时间（单条解析最高 300 秒，提交还需要上游请求时间）。如果提交结果未确认，请先核对任务页和 OpenList，避免重复提交。

## 文档

- [需求文档](docs/dev/requirements.md)
- [架构设计](docs/dev/architecture.md)
- [API 规范](docs/dev/api-spec.md)
- [前端开发说明](frontend/README.md)
- [前端目录优化 Batch 计划](docs/dev/frontend-structure-plan.md)

前端通过 `@tailwindcss/vite` 接入 Tailwind CSS v4，使用 shadcn/ui 与 Radix UI。React Router 管理路由与认证守卫，Zustand 管理会话，Axios 负责请求。开发时 Vite 将 `/api` 代理至 `http://127.0.0.1:8000`，生产由 FastAPI 托管 SPA。

## 项目结构

```
Kuroko/
├── Dockerfile        # 根目录多阶段镜像（前端构建 + 后端整合）
├── docker-compose.yml# Kuroko、元数据服务与 Redis 编排
├── Makefile          # 构建命令（make dev-backend 使用 python -m app.serve）
├── backend/          # FastAPI 后端
│   ├── app/
│   │   ├── serve.py  # 服务启动入口（python -m app.serve）
│   │   ├── api/      # API 路由
│   │   ├── core/     # 核心配置与 SPA 挂载
│   │   ├── models/   # 数据模型
│   │   ├── schemas/  # Pydantic Schema
│   │   ├── services/ # 业务逻辑
│   │   └── utils/    # 工具函数
│   └── tests/        # 测试
├── frontend/         # React 前端
│   ├── components.json # shadcn/ui 配置
│   └── src/
│       ├── services/ # Axios API 客户端与领域请求
│       ├── components/
│       │   ├── layout/ # Shell 应用布局
│       │   ├── common/ # 项目复用组件与认证表单
│       │   └── ui/     # shadcn/ui 基础组件
│       ├── pages/    # 六个业务页面、登录、初始化与 404
│       ├── routes/   # 路由定义、导航元数据与认证守卫
│       ├── hooks/    # 认证恢复、业务请求与轮询
│       ├── lib/      # cn、格式化等通用工具
│       ├── stores/   # Zustand 状态仓库
│       └── types/    # API 与领域类型
├── docs/             # 项目文档
│   └── dev/          # 开发文档
└── AGENTS.md         # AI Agent 指导
```

## 许可证

MIT
