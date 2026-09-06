"""FastAPI 应用入口。"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.v1.router import router as api_router
from app.core.config import get_settings
from app.core.database import ensure_runtime_dirs, init_db
from app.core.spa import mount_spa
from app.services.download_service import sync_tasks
from app.core.database import SessionLocal


async def _task_poller() -> None:
    while True:
        await asyncio.sleep(get_settings().task_poll_seconds)
        db = SessionLocal()
        try:
            sync_tasks(db)
        except Exception:
            pass
        finally:
            db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if settings.environment.lower() == "production" and settings.secret_key.get_secret_value() == "change-me-in-production":
        raise RuntimeError("生产环境必须配置 KUROKO_SECRET_KEY")
    ensure_runtime_dirs()
    init_db()
    poller = asyncio.create_task(_task_poller())
    try:
        yield
    finally:
        poller.cancel()
        await asyncio.gather(poller, return_exceptions=True)

app = FastAPI(
    title="Kuroko API",
    description="基于 OpenList 的磁力链接番号管理与离线下载系统",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# 跨域支持 (开发模式)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    code_map = {400: 40001, 401: 40102, 403: 40301, 404: 40401, 409: 40901, 502: 50201}
    return JSONResponse(status_code=exc.status_code, content={"code": code_map.get(exc.status_code, 50001), "message": str(exc.detail), "data": None})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"code": 40001, "message": "参数校验失败", "data": exc.errors()})


@app.get("/api/v1/health", tags=["System"])
async def health_check():
    """基础健康检查接口."""
    return {"code": 0, "message": "healthy", "data": {"status": "ok"}}


app.include_router(api_router)


# 挂载 SPA 静态托管 (必须在 API 注册完成后)
mount_spa(app)
