import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TaskStatus(StrEnum):
    pending = "pending"
    downloading = "downloading"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class DownloadTask(Base):
    __tablename__ = "download_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid.uuid4()), index=True)
    code: Mapped[str] = mapped_column(String(64), index=True)
    variant: Mapped[str] = mapped_column(String(16), default="original", server_default="original")
    magnet: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default=TaskStatus.pending.value, index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    speed: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_path: Mapped[str] = mapped_column(String(1024))
    openlist_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    total_size: Mapped[int] = mapped_column(Integer, default=0)
    downloaded_size: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
