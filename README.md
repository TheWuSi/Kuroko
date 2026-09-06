# Kuroko

> 基于 OpenList API 的磁力链接番号管理与离线下载系统

## 功能特性

- 🧲 **磁力链接解析** — 自动清理 tracker、提取番号、过滤广告文件
- 🔍 **番号去重** — 与 OpenList 文件库比对，避免重复下载
- ⬇️ **离线下载** — 通过 OpenList API 调用 PikPak 离线下载
- 📊 **智能调度** — 分组管理存储节点，自动选择最优下载位置
- 📈 **进度同步** — 实时同步并展示离线下载进度
- 💾 **空间统计** — 自动/手动统计各存储库剩余空间
- 🗂️ **番号统计** — 按探测路径扫描统计已有番号
- ⚙️ **在线配置** — 所有配置项支持前端在线修改

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.12+, FastAPI, SQLAlchemy 2, Pydantic 2, Alembic |
| 前端 | React 19, TypeScript, Vite, pnpm |
| UI 与样式 | shadcn/ui, Radix UI, Tailwind CSS v4 |
| 状态与请求 | Zustand, Axios |
| 代码质量 | Ruff, Pytest, Oxlint, Prettier |
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
docker compose up -d
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

- 已部署 [OpenList](https://github.com/OpenListTeam/OpenList)（>= 3.42.0）
- OpenList 中已挂载 PikPak 存储并配置好离线下载临时目录
- （可选）BT 解析服务用于磁力链接文件列表获取

## 文档

- [需求文档](docs/dev/requirements.md)
- [架构设计](docs/dev/architecture.md)
- [API 规范](docs/dev/api-spec.md)

前端通过 `@tailwindcss/vite` 接入 Tailwind CSS v4，使用 shadcn/ui 组件体系与 Radix UI 基础能力；Zustand 管理认证会话和界面状态，Axios 统一处理 API 请求与鉴权。源码由 Prettier 格式化，不再维护独立的 `App.css`。

## 项目结构

```
Kuroko/
├── Dockerfile        # 根目录多阶段镜像（前端构建 + 后端整合）
├── docker-compose.yml# 单服务编排（挂载 config/data/logs）
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
│       ├── api/      # Axios API 客户端与领域请求
│       ├── components/
│       │   ├── layout/ # 应用布局与认证界面
│       │   └── ui/     # shadcn/ui 基础组件与业务展示组件
│       ├── lib/      # cn、格式化等通用工具
│       ├── stores/   # Zustand 状态仓库
│       └── types/    # API 与领域类型
├── docs/             # 项目文档
│   └── dev/          # 开发文档
└── AGENTS.md         # AI Agent 指导
```

## 许可证

MIT
