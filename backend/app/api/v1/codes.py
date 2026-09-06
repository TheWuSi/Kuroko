import threading
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.code import CodeRecord
from app.models.config import ScanJob
from app.models.storage import StorageGroup
from app.schemas.code import ScanRequest
from app.services.config_service import get_config
from app.services.magnet_service import filter_files
from app.services.openlist_client import OpenListError
from app.services.storage_service import get_client
from app.utils.code_extractor import extract_code

router = APIRouter(prefix="/codes", tags=["Codes"], dependencies=[Depends(get_current_user)])
scan_lock = threading.Lock()


@router.get("")
def list_codes(group_id: int | None = Query(default=None, ge=1), search: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    query = db.query(CodeRecord)
    if search:
        query = query.filter(CodeRecord.code.contains(search[:64]))
    total = query.count()
    rows = query.order_by(CodeRecord.discovered_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return success({"total": total, "page": page, "page_size": page_size, "items": [{"code": row.code, "storage_path": row.storage_path, "file_name": row.file_name, "file_size": row.file_size, "discovered_at": row.discovered_at.isoformat()} for row in rows]})


@router.post("/scan")
def start_scan(payload: ScanRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if scan_lock.locked():
        raise HTTPException(status_code=409, detail="已有扫描任务正在运行")
    job = ScanJob(task_id=f"scan-{uuid.uuid4()}", group_id=payload.group_id)
    db.add(job)
    db.commit()
    background_tasks.add_task(run_scan, job.task_id)
    return success({"task_id": job.task_id, "status": job.status, "group_id": job.group_id})


@router.get("/scan/status")
def scan_status(task_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(ScanJob).order_by(ScanJob.started_at.desc())
    job = query.filter(ScanJob.task_id == task_id).first() if task_id else query.first()
    if job is None:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    return success({"task_id": job.task_id, "status": job.status, "scanned_files": job.scanned_files, "new_codes_found": job.new_codes_found, "current_path": job.current_path, "progress_percent": job.progress_percent, "started_at": job.started_at.isoformat(), "completed_at": job.completed_at.isoformat() if job.completed_at else None, "error_message": job.error_message})


@router.delete("/{code}")
def delete_code(code: str, db: Session = Depends(get_db)):
    rows = db.query(CodeRecord).filter(CodeRecord.code == code).all()
    if not rows:
        raise HTTPException(status_code=404, detail="番号不存在")
    for row in rows:
        db.delete(row)
    db.commit()
    return success({"code": code, "deleted": True})


def run_scan(task_id: str) -> None:
    if not scan_lock.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        job = db.query(ScanJob).filter(ScanJob.task_id == task_id).first()
        if job is None:
            return
        config = get_config(db, masked=False)
        groups = config.get("probe_paths", [])
        if job.group_id:
            group = db.get(StorageGroup, job.group_id)
            groups = [{"group_name": group.name, "paths": [{"storage_mount": p.storage_mount, "folder": p.folder_path} for p in group.paths]}] if group else []
        client = get_client(db)
        filter_config = config

        def walk_probe(root: str):
            """只在配置的探测根路径内递归，避免扫描 OpenList 根目录。"""
            pending = [root]
            visited: set[str] = set()
            while pending:
                current = pending.pop()
                normalized = str(PurePosixPath(current))
                if normalized in visited:
                    continue
                visited.add(normalized)
                entries = client.list_files(normalized)
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    name = str(entry.get("name") or entry.get("path") or "").strip()
                    if not name:
                        continue
                    is_dir = bool(entry.get("is_dir") or entry.get("isDir") or entry.get("directory") or str(entry.get("type", "")).lower() in {"dir", "directory", "folder"})
                    full_path = name if name.startswith("/") else str(PurePosixPath(normalized) / name)
                    if is_dir:
                        pending.append(full_path)
                    else:
                        yield {**entry, "name": full_path}

        for group in groups:
            for probe in group.get("paths", []):
                path = str(PurePosixPath(probe["storage_mount"]) / str(probe["folder"]).lstrip("/"))
                job.current_path = path
                for file in walk_probe(path):
                    job.scanned_files += 1
                    name = str(file.get("name") or file.get("path") or "")
                    valid, _ = filter_files([file], filter_config)
                    if not valid:
                        continue
                    code = extract_code(PurePosixPath(name).name)
                    if not code:
                        continue
                    file_path = PurePosixPath(name)
                    storage_path = str(file_path.parent)
                    file_name = file_path.name
                    exists = db.query(CodeRecord).filter(CodeRecord.code == code, CodeRecord.storage_path == storage_path, CodeRecord.file_name == file_name).first()
                    if exists:
                        continue
                    try:
                        with db.begin_nested():
                            db.add(CodeRecord(code=code, storage_path=storage_path, file_name=file_name, file_size=int(file.get("size") or file.get("length") or 0), source="scan"))
                            db.flush()
                            job.new_codes_found += 1
                    except Exception:
                        # 单个文件异常不应回滚整个扫描任务的计数和已入库记录。
                        continue
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
        db.close()
        scan_lock.release()
