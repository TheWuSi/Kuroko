"""番号库查询与定向探测服务。

路由层只负责鉴权、参数校验和响应格式；扫描的锁、目录遍历和入库都在此处，
这样后台任务可以复用同一套规则，也不会让 API 模块直接依赖 OpenList 细节。
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.code import CodeRecord
from app.models.config import ScanJob
from app.models.storage import StorageGroup
from app.services.config_service import get_config
from app.services.magnet_service import filter_files
from app.services.storage_service import get_client
from app.utils.code_extractor import extract_code
from app.utils.paths import child_path, is_within, join_path, normalize_path

scan_lock = threading.Lock()


def serialize_scan_job(job: ScanJob) -> dict[str, Any]:
    return {
        "task_id": job.task_id,
        "status": job.status,
        "scanned_files": job.scanned_files,
        "new_codes_found": job.new_codes_found,
        "current_path": job.current_path,
        "progress_percent": job.progress_percent,
        "started_at": job.started_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }


def create_scan_job(db: Session, group_id: int | None = None) -> ScanJob:
    if scan_lock.locked() or db.query(ScanJob).filter(ScanJob.status.in_(["pending", "scanning"])).first():
        raise ValueError("已有扫描任务正在运行")
    job = ScanJob(task_id=f"scan-{uuid.uuid4()}", group_id=group_id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def recover_orphaned_scans(db: Session) -> int:
    """服务重启时结束遗留任务，避免前端永远等待 scanning。"""
    rows = db.query(ScanJob).filter(ScanJob.status.in_(["pending", "scanning"])).all()
    for job in rows:
        job.status = "failed"
        job.error_message = "系统重启已中断扫描"
        job.completed_at = datetime.now(UTC)
    if rows:
        db.commit()
    return len(rows)


def _groups_for_job(db: Session, job: ScanJob, config: dict[str, Any]) -> list[dict[str, Any]]:
    if not job.group_id:
        return config.get("probe_paths", [])
    group = db.get(StorageGroup, job.group_id)
    if not group:
        return []
    return [{"group_name": group.name, "paths": [{"storage_mount": item.storage_mount, "folder": item.folder_path} for item in group.paths]}]


def _walk_probe(client: Any, root: str):
    """只在配置探测根内递归，并对路径做规范化去重。"""
    root = normalize_path(root)
    if root == "/":
        raise ValueError("请配置具体探测目录，不可扫描 OpenList 根目录")
    pending = [root]
    visited: set[str] = set()
    while pending:
        current = str(PurePosixPath(pending.pop()))
        if current in visited:
            continue
        visited.add(current)
        for entry in client.list_files(current):
            if not isinstance(entry, dict):
                continue
            full_path = child_path(current, entry["name"])
            if not is_within(full_path, root):
                raise ValueError("扫描路径超出了探测目录")
            if entry["is_dir"]:
                pending.append(full_path)
            else:
                yield {**entry, "name": full_path}


def run_scan(task_id: str) -> None:
    if not scan_lock.acquire(blocking=False):
        return
    db = SessionLocal()
    client = None
    try:
        job = db.query(ScanJob).filter(ScanJob.task_id == task_id).first()
        if not job:
            return
        job.status = "scanning"
        db.commit()
        config = get_config(db, masked=False)
        client = get_client(db)
        groups = _groups_for_job(db, job, config)
        total_paths = sum(len(group.get("paths", [])) for group in groups)
        processed_paths = 0
        for group in groups:
            for probe in group.get("paths", []):
                mount = str(probe.get("storage_mount", ""))
                folder = str(probe.get("folder", "/"))
                if not mount.startswith("/") or ".." in mount.split("/") or ".." in folder.split("/"):
                    continue
                root = join_path(mount, folder)
                job.current_path = root
                for file in _walk_probe(client, root):
                    job.scanned_files += 1
                    valid, _ = filter_files([file], config)
                    if not valid:
                        continue
                    name = str(file["name"])
                    code = extract_code(PurePosixPath(name).name, config["filter"].get("code_patterns", []))
                    if not code:
                        continue
                    path = PurePosixPath(name)
                    exists = db.query(CodeRecord).filter(CodeRecord.code == code, CodeRecord.storage_path == str(path.parent), CodeRecord.file_name == path.name).first()
                    if exists:
                        continue
                    db.add(CodeRecord(code=code, storage_path=str(path.parent), file_name=path.name, file_size=int(file.get("size") or file.get("length") or 0), source="scan"))
                    job.new_codes_found += 1
                processed_paths += 1
                job.progress_percent = round(processed_paths / total_paths * 100, 2) if total_paths else 100
                db.commit()
        job.status = "completed"
        job.progress_percent = 100
        job.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.query(ScanJob).filter(ScanJob.task_id == task_id).first()
        if job:
            job.status = "failed"
            job.error_message = str(exc)[:500]
            job.completed_at = datetime.now(UTC)
            db.commit()
    finally:
        if client is not None:
            client.close()
        db.close()
        scan_lock.release()
