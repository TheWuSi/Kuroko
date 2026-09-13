from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SystemConfig(Base):
    __tablename__ = "system_configs"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ScanJob(Base):
    __tablename__ = "scan_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="scanning")
    group_id: Mapped[int | None] = mapped_column(nullable=True)
    scanned_files: Mapped[int] = mapped_column(default=0)
    new_codes_found: Mapped[int] = mapped_column(default=0)
    duplicates_found: Mapped[int] = mapped_column(default=0, server_default="0")
    scan_paths: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    cancel_requested: Mapped[bool] = mapped_column(default=False, server_default="0")
    scanned_dirs: Mapped[int] = mapped_column(default=0, server_default="0")
    total_roots: Mapped[int] = mapped_column(default=0, server_default="0")
    completed_roots: Mapped[int] = mapped_column(default=0, server_default="0")
    current_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    progress_percent: Mapped[float] = mapped_column(default=0.0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
