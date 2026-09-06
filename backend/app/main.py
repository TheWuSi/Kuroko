"""FastAPI 应用入口骨架模块."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.spa import mount_spa

app = FastAPI(
    title="Kuroko API",
    description="基于 OpenList 的磁力链接番号管理与离线下载系统",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# 跨域支持 (开发模式)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health", tags=["System"])
async def health_check():
    """基础健康检查接口."""
    return {"code": 0, "message": "healthy", "data": {"status": "ok"}}


# 挂载 SPA 静态托管 (必须在 API 注册完成后)
mount_spa(app)
