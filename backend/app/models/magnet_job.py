"""磁力工作台的持久化批次、解析结果与提交凭据。"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MagnetParseJob(Base):
    __tablename__ = "magnet_parse_jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id"),
        Index("ix_magnet_parse_owner_status", "user_id", "status"),
    )

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    request_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    scope: Mapped[dict] = mapped_column(JSON, default=dict)
    filter_config: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MagnetParseItem(Base):
    __tablename__ = "magnet_parse_items"

    job_id: Mapped[str] = mapped_column(ForeignKey("magnet_parse_jobs.job_id", ondelete="CASCADE"), primary_key=True)
    index: Mapped[int] = mapped_column(primary_key=True)
    magnet: Mapped[str] = mapped_column(Text)
    info_hash: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempt: Mapped[int] = mapped_column(default=1)
    run_token: Mapped[str | None] = mapped_column(String(36))
    summary: Mapped[dict | None] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    # 用户手工指定或清空的番号；有值时优先于元数据识别结果，空串表示显式放弃识别。
    manual_code: Mapped[str | None] = mapped_column(String(64))
    # 重试需要等待的截止时刻；尚未到期的条目不会被后台线程领取。
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MagnetSubmission(Base):
    __tablename__ = "magnet_submissions"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id"),
        Index("ix_magnet_submission_owner_created", "user_id", "created_at"),
    )

    submission_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    job_id: Mapped[str] = mapped_column(ForeignKey("magnet_parse_jobs.job_id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    scope: Mapped[dict] = mapped_column(JSON)
    target_key: Mapped[str] = mapped_column(String(1100))
    force: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MagnetSubmissionItem(Base):
    __tablename__ = "magnet_submission_items"

    submission_id: Mapped[str] = mapped_column(
        ForeignKey("magnet_submissions.submission_id", ondelete="CASCADE"), primary_key=True
    )
    index: Mapped[int] = mapped_column(primary_key=True)
    info_hash: Mapped[str] = mapped_column(String(40), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    run_token: Mapped[str | None] = mapped_column(String(36))
    download_task_id: Mapped[str | None] = mapped_column(ForeignKey("download_tasks.task_id"))
    result: Mapped[dict | None] = mapped_column(JSON)
