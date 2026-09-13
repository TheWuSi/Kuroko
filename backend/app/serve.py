"""Kuroko 服务启动入口模块.

支持通过 `python -m app.serve` 启动服务, 专为容器化及开发环境适配.
在服务监听前负责环境自检、持久化目录(config, data, logs)初始化及 Uvicorn 运行时编排.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def prepare_directories(config_dir: Path, data_dir: Path, log_dir: Path) -> None:
    """初始化必需的目录结构, 保证 config/data/logs 可写."""
    for directory in (config_dir, data_dir, log_dir):
        directory.mkdir(parents=True, exist_ok=True)


def main() -> None:
    """主启动入口函数."""
    parser = argparse.ArgumentParser(description="Kuroko API & Web Server")
    parser.add_argument(
        "--host",
        default=os.getenv("KUROKO_HOST", "0.0.0.0"),
        help="绑定监听地址 (默认环境变量 KUROKO_HOST 或 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("KUROKO_PORT", "8000")),
        help="绑定监听端口 (默认环境变量 KUROKO_PORT 或 8000)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=os.getenv("KUROKO_RELOAD", "").lower() in ("true", "1"),
        help="开启热重载模式 (本地开发适用)",
    )
    parser.add_argument(
        "--log-level",
        default=os.getenv("KUROKO_LOG_LEVEL", "info"),
        help="日志级别 (debug, info, warning, error)",
    )
    args = parser.parse_args()

    # 读取目录路径配置 (优先环境变量, 默认相对于当前工作空间或容器根路径)
    config_dir = Path(os.getenv("KUROKO_CONFIG_DIR", "./config")).resolve()
    data_dir = Path(os.getenv("KUROKO_DATA_DIR", "./data")).resolve()
    log_dir = Path(os.getenv("KUROKO_LOG_DIR", "./logs")).resolve()

    prepare_directories(config_dir, data_dir, log_dir)

    print(f"[*] Kuroko Starting on {args.host}:{args.port}")
    print(f"[*] Config Dir: {config_dir}")
    print(f"[*] Data Dir:   {data_dir}")
    print(f"[*] Logs Dir:   {log_dir}")

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level.lower(),
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
