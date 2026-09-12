"""按分组的下载和归档目录扫描真实媒体，完整扫描成功后同步目录索引。"""

from __future__ import annotations

import threading
import time
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
from app.services.library_service import find_group, list_duplicates, path_condition
from app.services.magnet_service import filter_files
from app.services.openlist_client import OpenListError
from app.services.storage_service import get_client, group_roots, is_ignored_path, resolve_storage_path
from app.utils.code_extractor import extract_code, extract_variant
from app.utils.paths import child_path, is_within, join_path, normalize_path

scan_lock = threading.Lock()


class ScanBusyError(ValueError):
    pass


def serialize_scan_job(job: ScanJob) -> dict[str, Any]:
    return {
        "task_id": job.task_id,
        "group_id": job.group_id,
        "status": job.status,
        "scanned_files": job.scanned_files,
        "new_codes_found": job.new_codes_found,
        "duplicates_found": job.duplicates_found,
        "current_path": job.current_path,
        "progress_percent": job.progress_percent,
        "started_at": job.started_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }


def configured_scan_roots(db: Session, group_id: int | None = None) -> list[str]:
    groups = [find_group(db, group_id)] if group_id is not None else db.query(StorageGroup).all()
    roots = [root for group in groups for root in group_roots(db, group)]
    mounts = {member.storage_mount for group in groups for member in group.paths}
    if group_id is None:
        names = {group.name for group in groups}
        for probe in get_config(db, masked=False).get("probe_paths", []):
            if probe.get("group_name") not in names:
                for path in probe.get("paths", []):
                    mounts.add(path["storage_mount"])
                    root = join_path(path["storage_mount"], path["folder"])
                    if not is_ignored_path(db, root):
                        roots.append(root)
    if any(root == "/" or root in mounts for root in roots):
        raise ValueError("请配置具体下载或归档子目录，不可扫描整个挂载或 OpenList 根目录")
    return sorted(set(roots), key=lambda root: (len(root), root))


def create_scan_job(db: Session, group_id: int | None = None) -> ScanJob:
    if not configured_scan_roots(db, group_id):
        raise ValueError("没有可扫描的目录，请配置分组的下载、归档目录并检查忽略项")
    if not scan_lock.acquire(blocking=False):
        raise ScanBusyError("已有扫描任务正在运行")
    try:
        if db.query(ScanJob).filter(ScanJob.status.in_(["pending", "scanning"])).first():
            raise ScanBusyError("已有扫描任务正在运行")
        job = ScanJob(task_id=f"scan-{uuid.uuid4()}", group_id=group_id, status="pending")
        db.add(job)
        db.commit()
        db.refresh(job)
        return job
    finally:
        scan_lock.release()


def recover_orphaned_scans(db: Session) -> int:
    rows = db.query(ScanJob).filter(ScanJob.status.in_(["pending", "scanning"])).all()
    for job in rows:
        job.status = "failed"
        job.error_message = "系统重启已中断扫描"
        job.completed_at = datetime.now(UTC)
    if rows:
        db.commit()
    return len(rows)


def _walk_probe(client: Any, root: str, *, excluded: list[str], deadline: float):
    root = normalize_path(root)
    if root == "/":
        raise ValueError("不可扫描 OpenList 根目录")
    pending = [root]
    visited: set[str] = set()
    count = 0
    while pending:
        if time.monotonic() >= deadline or len(visited) >= 5000 or count >= 100000:
            raise ValueError("扫描超过时间或目录数量预算，请缩小扫描范围")
        current = pending.pop()
        if current in visited or any(is_within(current, mount) for mount in excluded):
            continue
        visited.add(current)
        # 用户发起的扫描读取最新目录；浏览器目录选择仍使用短时缓存。
        for entry in client.list_files(current, deadline=deadline, refresh=True):
            if time.monotonic() >= deadline or count >= 100000:
                raise ValueError("扫描超过时间或文件数量预算，请缩小扫描范围")
            full_path = child_path(current, entry["name"])
            if not is_within(full_path, root):
                raise ValueError("扫描路径超出了指定目录")
            count += 1
            if any(is_within(full_path, mount) for mount in excluded):
                continue
            if entry["is_dir"]:
                pending.append(full_path)
            else:
                yield {**entry, "name": full_path}


def _sync_root(db: Session, client, job: ScanJob, root: str, remote: list[dict], config: dict) -> None:
    storage, _ = resolve_storage_path(root, remote)
    if is_ignored_path(db, root, remote):
        return
    if storage["status"] != "work":
        raise ValueError("扫描范围内有不可用存储，请检查 OpenList 挂载状态")
    if root == storage["mount_path"]:
        raise ValueError("不可扫描整个挂载，请选择具体子目录")
    # 目录内的独立子挂载必须单独配置，不能随父节点扫描而越过分组边界。
    excluded = [
        item["mount_path"] for item in remote if item["id"] != storage["id"] and is_within(item["mount_path"], root)
    ]
    query = db.query(CodeRecord).filter(path_condition(CodeRecord.storage_path, [root]))
    if excluded:
        query = query.filter(~path_condition(CodeRecord.storage_path, excluded))
    previous = query.order_by(CodeRecord.id).all()
    by_location = {(row.storage_path, row.file_name): row for row in previous}
    seen: set[int] = set()
    job.current_path = root
    db.commit()
    for file in _walk_probe(client, root, excluded=excluded, deadline=time.monotonic() + 300):
        if is_ignored_path(db, root, remote):
            # 扫描期间新增忽略项时停止此节点，并保留尚未读取的旧记录。
            db.commit()
            return
        job.scanned_files += 1
        valid, _ = filter_files([file], config)
        if valid:
            path = PurePosixPath(file["name"])
            patterns = config["filter"].get("code_patterns", [])
            code = extract_code(path.name, patterns) or extract_code(str(path.parent), patterns)
            if code:
                location = (str(path.parent), path.name)
                row = by_location.get(location)
                if row is None:
                    row = CodeRecord(code=code, storage_path=location[0], file_name=location[1])
                    db.add(row)
                    by_location[location] = row
                    job.new_codes_found += 1
                row.code = code
                row.variant = extract_variant(str(path), code)
                row.file_size = file["size"]
                row.source = "scan"
                db.flush()
                seen.add(row.id)
        if job.scanned_files % 100 == 0:
            job.current_path = str(PurePosixPath(file["name"]).parent)
            db.commit()
    # 只有完整读取成功才清理消失、移动或已不符合过滤规则的扫描记录。
    # 权限失败、超时或超出预算会在上方抛出异常，绝不能用部分结果覆盖旧索引。
    for row in previous:
        if row.id not in seen and row.source == "scan" and not is_ignored_path(db, row.storage_path, remote):
            db.delete(row)
    db.commit()


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
        roots = configured_scan_roots(db, job.group_id)
        client = get_client(db)
        remote = client.get_storage_info(refresh=True)
        planned: list[tuple[str, int]] = []
        for root in roots:
            storage, _ = resolve_storage_path(root, remote)
            if is_ignored_path(db, root, remote):
                continue
            if any(owner == storage["id"] and is_within(root, parent) for parent, owner in planned):
                continue
            planned.append((root, storage["id"]))
        if not planned:
            raise ValueError("没有可扫描的目录，请检查分组成员和忽略项")
        for index, (root, _) in enumerate(planned):
            _sync_root(db, client, job, root, remote, config)
            job.progress_percent = round((index + 1) / len(planned) * 100, 2)
            db.commit()
        job.duplicates_found = len(list_duplicates(db, job.group_id))
        job.status = "completed"
        job.progress_percent = 100
        job.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.query(ScanJob).filter(ScanJob.task_id == task_id).first()
        if job:
            job.status = "failed"
            job.error_message = (
                str(exc)[:500] if isinstance(exc, (ValueError, OpenListError)) else "扫描失败，请检查服务状态后重试"
            )
            job.completed_at = datetime.now(UTC)
            db.commit()
    finally:
        if client is not None:
            client.close()
        db.close()
        scan_lock.release()
