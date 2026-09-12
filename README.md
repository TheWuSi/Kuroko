# Kuroko

> 基于 OpenList API 的磁力链接番号管理与离线下载系统

## 功能特性

- 🧲 **磁力链接解析** — 清理 tracker、提取番号、过滤展示文件；下载仍包含整个种子
- 🔍 **番号去重** — 与 OpenList 文件库比对，避免重复下载
- ⬇️ **离线下载** — 通过 OpenList 调用 PikPak，直接下载到指定目录，不追加番号子目录
- 📊 **智能调度** — 分组管理存储节点，自动选择最优下载位置
- 📈 **进度同步** — 分别展示离线与转存进度，库内文件由实际扫描确认
- 💾 **空间统计** — 自动/手动统计各存储库剩余空间
- 🗂️ **番号统计** — 按探测路径扫描统计已有番号
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

### 本地开发

```bash
# 安装依赖
make install

# 启动后端开发服务器
make dev-backend

# 启动前端开发服务器（另一个终端）
make dev-frontend
```

## 前置要求

- 已部署 [OpenList v4.2.6](https://github.com/OpenListTeam/OpenList/tree/v4.2.6)，使用管理员账号或管理员令牌
- OpenList 中已挂载 PikPak、配置离线临时目录，目标路径支持 PikPak 离线工具；离线、转存及清理由 OpenList 执行
- Compose 固定使用 `magnet-metadata-api:0.1.0`；解析服务不可用时仍可指定目录下载，自动容量调度需要完整元数据大小

## 接入与容量说明

在系统设置中填写 OpenList 地址及凭据，并测试连接；测试使用表单当前值，不会自动保存。OpenList 请求使用原始 `Authorization: <token>`；Kuroko 自身 API 继续使用 JWT Bearer。官方接口索引见 [OpenList llms.txt](https://fox.oplist.org/llms.txt)。

磁力工作台支持直接指定 OpenList 目录，例如 `/OD/Video`。留空时按存储分组自动选择目录，后端用完整种子大小调度，排除容量未知的节点，并保守计入尚在等待或下载的任务。文件过滤只用于番号识别与展示，不会筛选实际下载内容。任务显示“离线完成”后，还需检查独立的转存任务；扫描真实文件后才会更新番号库。

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
