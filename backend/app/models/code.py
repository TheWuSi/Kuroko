from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CodeRecord(Base):
    __tablename__ = "code_records"
    __table_args__ = (UniqueConstraint("code", "storage_path", "file_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(String(1024))
    file_name: Mapped[str] = mapped_column(String(1024))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String(32), default="scan")
