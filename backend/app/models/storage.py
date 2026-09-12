from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StorageGroup(Base):
    __tablename__ = "storage_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    paths: Mapped[list["StorageGroupPath"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class StorageGroupPath(Base):
    __tablename__ = "storage_group_paths"
    __table_args__ = (UniqueConstraint("group_id", "storage_mount", "folder_path"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("storage_groups.id", ondelete="CASCADE"), index=True)
    storage_mount: Mapped[str] = mapped_column(String(255))
    storage_id: Mapped[int | None] = mapped_column(nullable=True)
    folder_path: Mapped[str] = mapped_column(String(1024))
    archive_folders: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    group: Mapped[StorageGroup] = relationship(back_populates="paths")


class StorageIgnore(Base):
    __tablename__ = "storage_ignores"

    storage_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    storage_mount: Mapped[str] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StorageSpaceOverride(Base):
    __tablename__ = "storage_space_overrides"
    id: Mapped[int] = mapped_column(primary_key=True)
    storage_mount: Mapped[str] = mapped_column(String(255), unique=True)
    total_space_bytes: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
