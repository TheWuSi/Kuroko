"""SQLite 数据库和依赖注入。"""

import os
from collections.abc import Generator
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from alembic import command
from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
if settings.database_path:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    backend = Path(__file__).resolve().parents[2]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    with engine.begin() as connection:
        if connection.dialect.name == "sqlite":
            # sqlite3 默认不会为首个 DDL 开启事务，显式开始后升级中断才能完整回滚。
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        config.attributes["connection"] = connection
        tables = set(inspect(connection).get_table_names())
        version = (
            connection.execute(text("SELECT version_num FROM alembic_version")).first()
            if "alembic_version" in tables
            else None
        )
        # 早期版本使用 create_all，没有 Alembic 版本号；只为完整旧库建立基线。
        if version is None and "users" in tables:
            baseline = {
                "users",
                "system_configs",
                "storage_groups",
                "storage_group_paths",
                "storage_space_overrides",
                "download_tasks",
                "code_records",
                "scan_jobs",
            }
            if not baseline.issubset(tables):
                raise RuntimeError("现有数据库结构不完整，请检查迁移状态")
            command.stamp(config, "0001_initial")
        command.upgrade(config, "head")


def ensure_runtime_dirs() -> None:
    for directory in (
        Path(os.getenv("KUROKO_CONFIG_DIR", "./config")),
        Path(os.getenv("KUROKO_DATA_DIR", "./data")),
        Path(os.getenv("KUROKO_LOG_DIR", "./logs")),
    ):
        directory.mkdir(parents=True, exist_ok=True)
