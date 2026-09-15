# syntax=docker/dockerfile:1
# Kuroko - 基于 OpenList API 的磁力链接番号管理与离线下载系统

# --- 阶段 1: 前端构建 (使用 pnpm) ---
FROM node:22-slim AS web-builder
WORKDIR /app/frontend

RUN npm install -g pnpm@10

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ .
# 版本只参与应用构建，保留跨版本发布时的依赖层缓存。
ARG KUROKO_VERSION
RUN pnpm build

# --- 阶段 2: 运行镜像 ---
FROM python:3.12-slim AS base
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    KUROKO_HOST=0.0.0.0 \
    KUROKO_PORT=8000 \
    KUROKO_CONFIG_DIR=/app/config \
    KUROKO_DATA_DIR=/app/data \
    KUROKO_LOG_DIR=/app/logs \
    KUROKO_STATIC_DIR=/app/static

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 拷贝后端工程文件
COPY backend/app ./app
COPY backend/pyproject.toml .
# 启动迁移按 app 的相邻路径定位配置与脚本，必须一并交付。
COPY backend/alembic.ini .
COPY backend/alembic ./alembic

# 拷贝前端构建完成的静态文件
COPY --from=web-builder /app/frontend/dist /app/static

# 创建持久化和日志目录
RUN mkdir -p /app/config /app/data /app/logs

ARG KUROKO_VERSION
ENV KUROKO_VERSION=${KUROKO_VERSION}

EXPOSE 8000
VOLUME ["/app/config", "/app/data", "/app/logs"]

CMD ["python", "-m", "app.serve"]
