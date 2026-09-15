"""FastAPI 应用入口。"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router as api_router
from app.core.config import get_settings
from app.core.database import SessionLocal, ensure_runtime_dirs, init_db
from app.core.responses import ApiError
from app.core.spa import mount_spa
from app.core.version import get_version
from app.services.code_service import recover_orphaned_scans
from app.services.download_service import sync_tasks, sync_transfer_revision
from app.services.magnet_jobs import MagnetJobRunner


def _sync_in_worker() -> None:
    for sync in (sync_tasks, sync_transfer_revision):
        try:
            with SessionLocal() as db:
                sync(db)
        except Exception as exc:
            logging.getLogger(__name__).warning("OpenList 任务同步未完成：%s", type(exc).__name__)


async def _task_poller() -> None:
    while True:
        await asyncio.sleep(max(1, get_settings().task_poll_seconds))
        # 同步 HTTP 与 SQLite 工作放入工作线程，避免阻塞登录、健康检查等异步请求。
        await asyncio.to_thread(_sync_in_worker)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if (
        settings.environment.lower() == "production"
        and settings.secret_key.get_secret_value() == "change-me-in-production"
    ):
        raise RuntimeError("生产环境必须配置 KUROKO_SECRET_KEY")
    ensure_runtime_dirs()
    init_db()
    recovery_db = SessionLocal()
    try:
        recover_orphaned_scans(recovery_db)
    finally:
        recovery_db.close()
    poller = asyncio.create_task(_task_poller())
    magnet_runner = MagnetJobRunner()
    magnet_runner.start()
    try:
        yield
    finally:
        await asyncio.to_thread(magnet_runner.stop)
        poller.cancel()
        await asyncio.gather(poller, return_exceptions=True)


app = FastAPI(
    title="Kuroko API",
    description="基于 OpenList 的磁力链接番号管理与离线下载系统",
    version=get_version(),
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
    code = exc.code if isinstance(exc, ApiError) else code_map.get(exc.status_code, 50001)
    return JSONResponse(status_code=exc.status_code, content={"code": code, "message": str(exc.detail), "data": None})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # Pydantic 的 input/ctx 可能含账号口令或不可序列化的异常对象，不对外返回。
    details = [{"loc": item["loc"], "type": item["type"]} for item in exc.errors()]
    return JSONResponse(status_code=422, content={"code": 40001, "message": "参数校验失败", "data": details})


@app.get("/api/v1/health", tags=["System"])
async def health_check():
    """基础健康检查接口."""
    return {"code": 0, "message": "healthy", "data": {"status": "ok", "version": app.version}}


app.include_router(api_router)


# 挂载 SPA 静态托管 (必须在 API 注册完成后)
mount_spa(app)
