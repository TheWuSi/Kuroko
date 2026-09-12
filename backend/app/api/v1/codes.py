from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.code import CodeRecord
from app.schemas.code import ScanRequest
from app.models.config import ScanJob
from app.services.code_service import create_scan_job, run_scan, serialize_scan_job

router = APIRouter(prefix="/codes", tags=["Codes"], dependencies=[Depends(get_current_user)])
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
    try:
        job = create_scan_job(db, payload.group_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    background_tasks.add_task(run_scan, job.task_id)
    return success({"task_id": job.task_id, "status": job.status, "group_id": job.group_id})


@router.get("/scan/status")
def scan_status(task_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(ScanJob).order_by(ScanJob.started_at.desc())
    job = query.filter(ScanJob.task_id == task_id).first() if task_id else query.first()
    if job is None:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    return success(serialize_scan_job(job))


@router.delete("/{code}")
def delete_code(code: str, db: Session = Depends(get_db)):
    rows = db.query(CodeRecord).filter(CodeRecord.code == code).all()
    if not rows:
        raise HTTPException(status_code=404, detail="番号不存在")
    for row in rows:
        db.delete(row)
    db.commit()
    return success({"code": code, "deleted": True})
