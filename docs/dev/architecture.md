# Kuroko 架构设计

| 文档版本 | 状态 | 编写日期 | 适用系统版本 |
| :--- | :--- | :--- | :--- |
| v2.0.0 | 规划定稿 | 2026-09-11 | Kuroko v2.0+ |

---

## 1. 系统架构概览

Kuroko 是一套面向媒体番号资产管理、磁力链接清洗解析、离线下载智能调度与存储空间拓扑管理的现代化 Web 应用，采用前后端分离但支持单镜像整合部署的系统架构。

核心组件如下：
- **前端（Frontend SPA）**：基于 Vite + React 19 + TypeScript + Zustand + Shadcn/ui + Tailwind CSS (v4) 构建，贯彻 **Porcelain Tech（白瓷科技亮色优先）** 美术设计语言并全端响应式适配手机、平板与桌面。在生产环境中由 FastAPI 挂载的 SPA 静态中间件统一托管。
- **后端（Backend RESTful API）**：基于 FastAPI 构建的高性能异步接口服务，承担 JWT 鉴权、磁力链接清洗、两阶段番号识别、库内去重、Best-Fit 碎片空间优先调度算法及下载任务轮询同步。
- **持久层（Database）**：嵌入式 SQLite 搭配 SQLAlchemy 2.0 ORM，持久化用户、任务、番号记录、存储分组与系统配置。
- **外部协同服务**：
  - **OpenList 服务**：底层网盘聚合与文件管理抽象平台，作为 PikPak 离线下载的底层执行引擎。
  - **magnet-metadata-api**：独立部署的 Go 语言开源服务（基于 BitTorrent DHT/Peer 网络与 Redis 缓存），用于快速抓取磁力链接元数据与文件树。

### 1.1 系统架构拓扑图

```mermaid
graph TD
    User["用户浏览器 (PC / 手机端 Web UI)"]

    subgraph "Kuroko 服务容器 (Docker / FastAPI)"
        FastAPI["FastAPI 异步后端 (:8000)"]
        SPA["React 19 SPA 静态托管 (Porcelain Tech 亮色优先 / 响应式 UI)"]
        SQLite[("SQLite 数据库 (kuroko.db)")]
    end

    subgraph "外部协同系统"
        OpenList["OpenList 服务 (:5244)<br/>(网盘聚合 / PikPak 离线下载)"]
        subgraph "BT 元数据解析服务"
            BTAPI["magnet-metadata-api (:8080)<br/>(DHT / Peer 网络元数据提取)"]
            Redis[("Redis 缓存 (:6379)")]
        end
    end

    User -->|"HTTP/HTTPS 交互"| FastAPI
    FastAPI -->|"挂载与 SPA 路由回退"| SPA
    FastAPI -->|"SQLAlchemy ORM 持久化"| SQLite
    FastAPI -->|"RESTful API (存储信息/任务下发/进度同步)"| OpenList
    FastAPI -->|"POST /api/v1/metadata (获取文件列表)"| BTAPI
    BTAPI -->|"内存加速与缓存命中"| Redis
```

---

## 2. 后端架构设计

### 2.1 目录结构与分层

```text
backend/app/
├── main.py                  # FastAPI 应用入口、全局异常捕获、CORS 与生命周期事件
├── serve.py                 # 生产启动入口 (python -m app.serve，自动准备目录与信号治理)
├── core/
│   ├── config.py            # 基础环境变量加载与默认项
│   ├── database.py          # SQLAlchemy 引擎、SessionLocal 依赖注入与 SQLite 连接池
│   ├── responses.py         # 统一 JSON 响应封装 (code, message, data)
│   ├── security.py          # JWT Token 签发/校验与密码哈希
│   └── spa.py               # 静态文件 SPA 路由回退中间件
├── api/
│   └── v1/
│       ├── router.py        # 路由聚合器
│       ├── auth.py          # 登录认证与 Token 刷新
│       ├── magnets.py       # 磁力解析、两阶段番号识别、批量提交
│       ├── tasks.py         # 任务监控列表、详情、取消与进度同步
│       ├── storages.py      # 存储挂载点拓扑、存储分组 CRUD、手动容量覆盖
│       ├── codes.py         # 番号资产分页查询、删除、定向扫描触发与状态
│       └── config.py        # 系统动态配置 CRUD、OpenList 与 BT 解析连通性测试
├── models/                  # SQLAlchemy 数据库实体
│   ├── user.py              # 用户表
│   ├── task.py              # 下载任务表 (DownloadTask)
│   ├── code.py              # 番号归档记录表 (CodeRecord)
│   ├── storage.py           # 存储分组及挂载路径表 (StorageGroup, StorageGroupPath, StorageSpaceOverride)
│   └── config.py            # 动态键值配置表与扫描任务表 (SystemConfig, ScanJob)
├── schemas/                 # Pydantic 强类型校验模型 (DTO)
│   ├── auth.py, magnet.py, task.py, storage.py, code.py, config.py, common.py
├── services/                # 领域核心业务逻辑层
│   ├── auth_service.py      # 用户鉴权与口令验证
│   ├── magnet_service.py    # 磁力解析控制编排、两阶段番号复核、文件过滤管道
│   ├── magnet_metadata_client.py # 对接 magnet-metadata-api 的标准适配器
│   ├── openlist_client.py   # OpenList API 客户端 (账号密码与 Token 双鉴权，自动重登)
│   ├── download_service.py  # 离线下载调度、去重拦截与强制下载通道
│   ├── storage_service.py   # 存储容量统计与 Best-Fit 碎片空间优先调度算法
│   ├── code_service.py      # 定向探测路径扫描、规则过滤与番号归档 (解耦独立)
│   └── config_service.py    # 动态系统配置读写与掩码脱敏
└── utils/
    ├── magnet_parser.py     # 磁力链接标准化与冗余 Tracker 净化工具
    └── code_extractor.py    # 番号通用正则匹配与格式归一化工具
```

### 2.2 核心服务协作流程

#### 磁力解析、复核与去重流转图
```mermaid
sequenceDiagram
    autonumber
    actor User as 用户 (前端界面)
    participant API as Magnets 路由 (api/v1/magnets)
    participant MagSvc as 磁力服务 (magnet_service)
    participant BTClient as 元数据客户端 (magnet_metadata_client)
    participant BTService as magnet-metadata-api (:8080)
    participant DB as SQLite (CodeRecord 表)

    User->>API: POST /api/v1/magnets/parse (链接列表)
    API->>MagSvc: parse_magnets(db, links)
    loop 遍历磁力链接
        MagSvc->>MagSvc: clean_magnet (剔除 Tracker，提取 dn 初筛番号)
        MagSvc->>BTClient: fetch_metadata(cleaned_magnet)
        alt 服务正常且 DHT 命中
            BTClient->>BTService: POST /api/v1/metadata
            BTService-->>BTClient: 返回文件树 (path, size, offset)
            MagSvc->>MagSvc: 过滤文件 (扩展名/体积/黑名单) 并提取深层番号
        else 超时或服务异常
            BTClient-->>MagSvc: 优雅降级 (使用 dn 候选番号，标记 fallback)
        end
        MagSvc->>DB: 查询番号是否已存在
        DB-->>MagSvc: 返回存在记录或空
    end
    MagSvc-->>API: 组合返回两阶段解析结果与去重状态
    API-->>User: HTTP 200 (前端渲染卡片与跳过/强制操作)
```

---

## 3. 前端架构与美术设计系统

### 3.1 技术栈与架构分层
- **技术选型**：React 19 + TypeScript + Vite + Zustand + Shadcn/ui + Tailwind CSS (v4) + Axios。
- **设计模式**：采用组件分层架构（`ui/` 原子组件、`common/` 复合组件、`features/` 领域组件、`layout/` 框架布局），通过 Zustand 实现单向数据流。

### 3.2 美术设计方案 (Porcelain Tech 亮色优先)
- **视觉风格**：现代高质感白瓷科技风（亮色优先，保留深色切换能力），底色采用温和的 `bg-slate-50`，卡片采用纯白 `bg-white` 配合精细微阴影 `shadow-sm shadow-slate-900/5` 与细腻边框 `border-slate-200/80`。
- **全端响应式体系 (Mobile-First)**：
  - 手机端：顶部紧凑 TopNav + 汉堡抽屉 Sheet 导航，按钮触控区 `>= 44px`；
  - 表格智能降级：任务列表与番号列表在移动端自适应折叠为垂直卡片流，杜绝横向滚动断裂；
  - 桌面端：常驻左侧 240px 侧边栏，大盘数据表格与双栏工作台。
- **色彩令牌体系 (Tokens)**：
  - 底色系统：底层温和微冷灰 (`#f8fafc`)、白瓷卡片色 (`#ffffff`)、悬停浮层色 (`#f1f5f9`)；
  - 高光与品牌：深邃群青蓝 (`#2563eb`)、天蓝高光 (`#0284c7`)；
  - 语义状态：就绪/成功绿 (`#059669`)、已存在/跳过金 (`#d97706`)、错误/已满红 (`#e11d48`)；
  - 数据等宽字体：番号、哈希、路径与容量统一使用 `JetBrains Mono`。
- **动态微交互**：
  - 输入框实时磁力 Tracker 净化微光提示动效；
  - 碎片空间优先（Best-Fit）算法推荐节点高光呼吸流；
  - 实时下载流动态进度条波纹。

---

## 4. 数据持久化模型 (ER 关系图)

```mermaid
erDiagram
    User {
        integer id PK
        string username UK
        string hashed_password
        datetime created_at
    }

    DownloadTask {
        integer id PK
        string task_id UK
        string code
        string magnet
        string status
        float progress
        string speed
        integer total_size
        integer downloaded_size
        string target_path
        string openlist_task_id
        string error_message
        datetime created_at
        datetime updated_at
    }

    CodeRecord {
        integer id PK
        string code
        string storage_path
        string file_name
        integer file_size
        string source
        datetime discovered_at
    }

    StorageGroup {
        integer id PK
        string name UK
        datetime created_at
    }

    StorageGroupPath {
        integer id PK
        integer group_id FK
        string storage_mount
        string folder_path
    }

    StorageSpaceOverride {
        integer id PK
        string storage_mount UK
        integer total_space_bytes
        datetime updated_at
    }

    SystemConfig {
        integer id PK
        string key UK
        string value
        datetime updated_at
    }

    ScanJob {
        integer id PK
        string task_id UK
        integer group_id
        string status
        integer scanned_files
        integer new_codes_found
        string current_path
        float progress_percent
        string error_message
        datetime started_at
        datetime completed_at
    }

    StorageGroup ||--o{ StorageGroupPath : "包含"
```

---

## 5. 部署与协同编排

系统提供 `docker-compose.yml`，支持一键拉起全套微服务：

```yaml
services:
  kuroko:
    image: ghcr.io/<owner>/kuroko:latest
    container_name: kuroko
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT:-8000}:8000"
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - BACKEND_PORT=8000
      - KUROKO_SECRET_KEY=${KUROKO_SECRET_KEY:-kuroko-secret-change-in-prod}
      - BT_PARSER_SERVICE_URL=http://magnet-metadata-api:8080
    depends_on:
      - magnet-metadata-api

  magnet-metadata-api:
    image: felipemarinho97/magnet-metadata-api:latest
    container_name: kuroko-magnet-metadata
    restart: unless-stopped
    ports:
      - "${METADATA_PORT:-8080}:8080"
    environment:
      - PORT=8080
      - REDIS_URL=redis://redis:6379/0
      - CACHE_TTL_HOURS=168
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    container_name: kuroko-redis
    restart: unless-stopped
    volumes:
      - ./data/redis:/data
```
