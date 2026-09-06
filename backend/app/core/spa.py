"""SPA 前端单页应用挂载与回退支持模块.

参考 Amane SPA 实现, 将前端静态构建产物无缝嵌入 FastAPI:
- 优先路由到后端 /api/v1 接口及 OpenAPI 规范接口 (/docs, /redoc, /openapi.json);
- /assets 静态资源目录高效托管;
- 前端路由 Fallback 到 index.html (SPA 客户端路由驱动);
- 若静态目录未就绪 (本地纯后端开发模式), 返回引导提示页.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import FileResponse, HTMLResponse
from starlette.staticfiles import StaticFiles

if TYPE_CHECKING:
    from fastapi import FastAPI
    from starlette.requests import Request
    from starlette.responses import Response

# 排除在外、不应被 SPA 拦截的路径前缀
RESERVED_PREFIXES = ("/api/", "/docs", "/redoc", "/openapi.json")


def get_static_dir() -> Path:
    """定位前端打包静态产物目录."""
    override = os.getenv("KUROKO_STATIC_DIR")
    if override:
        return Path(override).resolve()

    # 依次探测: /app/static (Docker), ./static, ../frontend/dist (本地开发)
    candidates = [
        Path("/app/static"),
        Path(__file__).resolve().parents[2] / "static",
        Path(__file__).resolve().parents[3] / "frontend" / "dist",
    ]
    for p in candidates:
        if p.is_dir() and (p / "index.html").is_file():
            return p
    return candidates[0]


class SPAMiddleware(BaseHTTPMiddleware):
    """SPA 路由拦截中间件: 未命中的非 API GET 请求统一回退到 index.html."""

    def __init__(self, app, static_dir: Path):
        super().__init__(app)
        self.static_dir = static_dir
        self.index_html = static_dir / "index.html"

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # 保留接口直接放行
        if any(path.startswith(prefix) for prefix in RESERVED_PREFIXES):
            return await call_next(request)

        # 仅针对 GET/HEAD 进行静态文件或 SPA 页面匹配
        if request.method in ("GET", "HEAD"):
            # 检查是否有对应的真实静态文件存在
            file_path = self.static_dir / path.lstrip("/")
            if file_path.is_file():
                return FileResponse(file_path)

            # SPA 单页路由回退
            if self.index_html.is_file():
                return FileResponse(self.index_html)
            elif path == "/" or not any(path.startswith(prefix) for prefix in RESERVED_PREFIXES):
                # 未构建前端时的友好提示
                return HTMLResponse(
                    "<html><body style='font-family:sans-serif;padding:40px;line-height:1.6;'>"
                    "<h2>Kuroko 服务运行中</h2>"
                    "<p>前端静态资源未就绪，可访问 <a href='/docs'>/docs</a> 调试 API 接口，"
                    "或运行 <code>pnpm build</code> 构建前端。</p>"
                    "</body></html>",
                    status_code=200,
                )

        return await call_next(request)


def mount_spa(app: FastAPI) -> None:
    """为 FastAPI 应用挂载 SPA 静态资源与路由中间件."""
    static_dir = get_static_dir()

    # 如果构建目录存在 assets, 挂载 StaticFiles
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # 注册 SPA Fallback 中间件
    app.add_middleware(SPAMiddleware, static_dir=static_dir)
